import { NextResponse } from "next/server";
import { CITIES } from "@/lib/cities";

export type HourlyPoint = {
  time: string; // ISO, UTC
  temperature: number;
  windSpeed: number;
  precipitation: number;
  weatherCode: number;
  aqi: number;
  pm25: number;
};

export type CityWeather = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
  temperature: number;
  windSpeed: number;
  precipitation: number;
  weatherCode: number;
  isDay: boolean;
  aqi: number;
  pm25: number;
  // Past 48h + next 24h at hourly resolution, anchored to UTC so every city
  // shares one aligned timeline — what powers the time-scrubber.
  hourly: HourlyPoint[];
};

type OpenMeteoCurrent = {
  time: string;
  temperature_2m: number;
  wind_speed_10m: number;
  precipitation: number;
  weather_code: number;
  is_day: number;
};

type OpenMeteoHourly = {
  time: string[];
  temperature_2m: number[];
  wind_speed_10m: number[];
  precipitation: number[];
  weather_code: number[];
};

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  current: OpenMeteoCurrent;
  hourly?: OpenMeteoHourly;
};

type AirQualityCurrent = {
  time: string;
  us_aqi: number;
  pm2_5: number;
};

type AirQualityHourly = {
  time: string[];
  us_aqi: number[];
  pm2_5: number[];
};

type AirQualityResponse = {
  latitude: number;
  longitude: number;
  current: AirQualityCurrent;
  hourly?: AirQualityHourly;
};

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

// Past 2 days + next 1 day, hourly — a rolling window for the time-scrubber.
const PAST_DAYS = 2;
const FORECAST_DAYS = 1;

function normalize<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [data as T];
}

export async function GET() {
  const lats = CITIES.map((c) => c.lat).join(",");
  const lons = CITIES.map((c) => c.lon).join(",");

  const weatherUrl =
    `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}` +
    `&current=temperature_2m,wind_speed_10m,weather_code,precipitation,is_day&timezone=auto`;

  // Hourly data, pinned to UTC (and unix timestamps, to sidestep any
  // ambiguity in parsing timezone-less ISO strings) so every city shares one
  // aligned timeline — that's what powers the time-scrubber. This is
  // deliberately a separate request from the "current" one above: requesting
  // hourly with timezone=auto would anchor each city's array to its own
  // local midnight, so index i wouldn't be the same UTC instant everywhere.
  const hourlyUtcUrl =
    `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}` +
    `&hourly=temperature_2m,wind_speed_10m,precipitation,weather_code` +
    `&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=UTC&timeformat=unixtime`;

  const airQualityUrl = `${AIR_QUALITY_URL}?latitude=${lats}&longitude=${lons}&current=us_aqi,pm2_5&timezone=auto`;

  const airQualityHourlyUtcUrl =
    `${AIR_QUALITY_URL}?latitude=${lats}&longitude=${lons}` +
    `&hourly=us_aqi,pm2_5&past_days=${PAST_DAYS}&forecast_days=${FORECAST_DAYS}&timezone=UTC&timeformat=unixtime`;

  try {
    const weatherRes = await fetch(weatherUrl, {
      // Cache on the server for 5 minutes so repeated visits don't hammer Open-Meteo.
      next: { revalidate: 300 },
    });

    if (!weatherRes.ok) {
      throw new Error(`Open-Meteo responded with ${weatherRes.status}`);
    }

    const weatherResults = normalize<OpenMeteoResponse>(await weatherRes.json());

    // Everything below is a "nice to have": if any of these fail, the app
    // still renders fine with hourly/aqi left empty/NaN (same graceful
    // degradation pattern as the rest of the app).
    let airQualityResults: AirQualityResponse[] = [];
    let hourlyWeatherResults: OpenMeteoResponse[] = [];
    let hourlyAqResults: AirQualityResponse[] = [];

    const [aqSettled, hourlyWeatherSettled, hourlyAqSettled] = await Promise.allSettled([
      fetch(airQualityUrl, { next: { revalidate: 300 } }),
      fetch(hourlyUtcUrl, { next: { revalidate: 300 } }),
      fetch(airQualityHourlyUtcUrl, { next: { revalidate: 300 } }),
    ]);

    if (aqSettled.status === "fulfilled" && aqSettled.value.ok) {
      airQualityResults = normalize<AirQualityResponse>(await aqSettled.value.json());
    }
    if (hourlyWeatherSettled.status === "fulfilled" && hourlyWeatherSettled.value.ok) {
      hourlyWeatherResults = normalize<OpenMeteoResponse>(await hourlyWeatherSettled.value.json());
    }
    if (hourlyAqSettled.status === "fulfilled" && hourlyAqSettled.value.ok) {
      hourlyAqResults = normalize<AirQualityResponse>(await hourlyAqSettled.value.json());
    }

    const cities: CityWeather[] = CITIES.map((city, i) => {
      const current = weatherResults[i]?.current;
      const air = airQualityResults[i]?.current;

      const wHourly = hourlyWeatherResults[i]?.hourly;
      const aHourly = hourlyAqResults[i]?.hourly;
      const hourly: HourlyPoint[] = (wHourly?.time ?? []).map((unixSeconds, idx) => ({
        time: new Date(Number(unixSeconds) * 1000).toISOString(),
        temperature: wHourly?.temperature_2m[idx] ?? NaN,
        windSpeed: wHourly?.wind_speed_10m[idx] ?? NaN,
        precipitation: wHourly?.precipitation[idx] ?? NaN,
        weatherCode: wHourly?.weather_code[idx] ?? 0,
        aqi: aHourly?.us_aqi[idx] ?? NaN,
        pm25: aHourly?.pm2_5[idx] ?? NaN,
      }));

      return {
        id: city.id,
        name: city.name,
        country: city.country,
        lat: city.lat,
        lon: city.lon,
        temperature: current?.temperature_2m ?? NaN,
        windSpeed: current?.wind_speed_10m ?? 0,
        precipitation: current?.precipitation ?? 0,
        weatherCode: current?.weather_code ?? 0,
        isDay: (current?.is_day ?? 1) === 1,
        aqi: air?.us_aqi ?? NaN,
        pm25: air?.pm2_5 ?? NaN,
        hourly,
      };
    });

    return NextResponse.json(
      {
        fetchedAt: new Date().toISOString(),
        cities,
      },
      {
        // Lets Netlify's edge CDN serve repeat requests within the window
        // without re-invoking this function at all — the main defense
        // against a traffic spike (legitimate or not) driving up function
        // invocations, on top of the upstream-fetch caching above.
        headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to fetch live weather from Open-Meteo",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
