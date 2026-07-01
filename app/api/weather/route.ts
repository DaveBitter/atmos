import { NextResponse } from "next/server";
import { CITIES } from "@/lib/cities";

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
};

type OpenMeteoCurrent = {
  time: string;
  temperature_2m: number;
  wind_speed_10m: number;
  precipitation: number;
  weather_code: number;
  is_day: number;
};

type OpenMeteoResponse = {
  latitude: number;
  longitude: number;
  current: OpenMeteoCurrent;
};

type AirQualityCurrent = {
  time: string;
  us_aqi: number;
  pm2_5: number;
};

type AirQualityResponse = {
  latitude: number;
  longitude: number;
  current: AirQualityCurrent;
};

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";

export async function GET() {
  const lats = CITIES.map((c) => c.lat).join(",");
  const lons = CITIES.map((c) => c.lon).join(",");

  const weatherUrl = `${OPEN_METEO_URL}?latitude=${lats}&longitude=${lons}&current=temperature_2m,wind_speed_10m,weather_code,precipitation,is_day&timezone=auto`;
  const airQualityUrl = `${AIR_QUALITY_URL}?latitude=${lats}&longitude=${lons}&current=us_aqi,pm2_5&timezone=auto`;

  try {
    const weatherRes = await fetch(weatherUrl, {
      // Cache on the server for 5 minutes so repeated visits don't hammer Open-Meteo.
      next: { revalidate: 300 },
    });

    if (!weatherRes.ok) {
      throw new Error(`Open-Meteo responded with ${weatherRes.status}`);
    }

    const weatherData = await weatherRes.json();

    // Open-Meteo returns a single object for one location, or an array for
    // multiple comma-separated locations — normalize to an array either way.
    const weatherResults: OpenMeteoResponse[] = Array.isArray(weatherData)
      ? weatherData
      : [weatherData];

    // Air quality is a "nice to have" — if it fails, weather should still
    // render fine with aqi/pm25 left as NaN (handled like any other missing metric).
    let airQualityResults: AirQualityResponse[] = [];
    try {
      const aqRes = await fetch(airQualityUrl, { next: { revalidate: 300 } });
      if (aqRes.ok) {
        const aqData = await aqRes.json();
        airQualityResults = Array.isArray(aqData) ? aqData : [aqData];
      }
    } catch {
      // swallow — air quality is optional
    }

    const cities: CityWeather[] = CITIES.map((city, i) => {
      const current = weatherResults[i]?.current;
      const air = airQualityResults[i]?.current;
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
      };
    });

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      cities,
    });
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
