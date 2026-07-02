import { NextResponse } from "next/server";
import { CITIES } from "@/lib/cities";
import { cachedFetch, RateLimitError } from "@/lib/serverCache";

export type DailySnapshot = {
  id: string;
  date: string;
  tempMax: number;
  tempMin: number;
  tempMean: number;
  windMax: number;
  precipSum: number;
  weatherCode: number;
};

type ArchiveDaily = {
  time: string[];
  weather_code: number[];
  temperature_2m_max: number[];
  temperature_2m_min: number[];
  temperature_2m_mean: number[];
  precipitation_sum: number[];
  wind_speed_10m_max: number[];
};

type ArchiveResponse = {
  latitude: number;
  longitude: number;
  daily?: ArchiveDaily;
};

const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function normalize<T>(data: unknown): T[] {
  return Array.isArray(data) ? (data as T[]) : [data as T];
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (!date || !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Missing or invalid ?date= (expected YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    // A fixed past date's daily aggregate never changes, so once fetched it's
    // cached indefinitely (both here and via revalidate: false below) and
    // concurrent requests for the same date are coalesced into one upstream
    // call — see lib/serverCache.ts.
    const cities = await cachedFetch(`history:${date}`, async () => {
      const lats = CITIES.map((c) => c.lat).join(",");
      const lons = CITIES.map((c) => c.lon).join(",");

      const url =
        `${ARCHIVE_URL}?latitude=${lats}&longitude=${lons}` +
        `&start_date=${date}&end_date=${date}` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,temperature_2m_mean,precipitation_sum,wind_speed_10m_max` +
        `&timezone=UTC`;

      const res = await fetch(url, { next: { revalidate: false } });
      if (res.status === 429) throw new RateLimitError("Open-Meteo archive");
      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`Open-Meteo archive responded with ${res.status}${body ? `: ${body}` : ""}`);
      }

      const results = normalize<ArchiveResponse>(await res.json());

      return CITIES.map((city, i): DailySnapshot => {
        const daily = results[i]?.daily;
        return {
          id: city.id,
          date,
          tempMax: daily?.temperature_2m_max?.[0] ?? NaN,
          tempMin: daily?.temperature_2m_min?.[0] ?? NaN,
          tempMean: daily?.temperature_2m_mean?.[0] ?? NaN,
          windMax: daily?.wind_speed_10m_max?.[0] ?? NaN,
          precipSum: daily?.precipitation_sum?.[0] ?? NaN,
          weatherCode: daily?.weather_code?.[0] ?? 0,
        };
      });
    });

    return NextResponse.json(
      { date, cities },
      {
        // A fixed past date's daily aggregate never changes — safe to let
        // Netlify's CDN cache this indefinitely, so a burst of requests for
        // the same historical date (deliberate or not) never re-invokes
        // this function after the first one.
        headers: { "Cache-Control": "public, s-maxage=31536000, immutable" },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof RateLimitError
            ? "Rate limited by Open-Meteo"
            : "Failed to fetch historical weather from Open-Meteo",
        detail: err instanceof Error ? err.message : String(err),
        rateLimited: err instanceof RateLimitError,
      },
      { status: err instanceof RateLimitError ? 429 : 502 }
    );
  }
}
