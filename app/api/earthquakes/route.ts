import { NextResponse } from "next/server";
import { cachedFetch, RateLimitError } from "@/lib/serverCache";

export type Earthquake = {
  id: string;
  mag: number;
  place: string;
  time: string; // ISO timestamp
  depthKm: number;
  lat: number;
  lon: number;
  url: string;
};

type UsgsFeature = {
  id: string;
  properties: {
    mag: number | null;
    place: string | null;
    time: number;
    url: string;
  };
  geometry: {
    coordinates: [number, number, number]; // lon, lat, depth (km)
  };
};

type UsgsFeed = {
  features: UsgsFeature[];
};

// Live feed: magnitude 4.5+, past day — a manageable, genuinely newsworthy
// set of events that keeps the layer live-feeling without drowning the map.
const USGS_LIVE_URL = "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

// Historical: USGS's FDSN event query supports arbitrary date ranges going
// back to the early 1900s (completeness varies by era/region, but it's real
// data, not a synthetic fill-in).
const USGS_QUERY_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseFeed(data: UsgsFeed): Earthquake[] {
  return data.features
    .filter((f) => f.properties.mag !== null)
    .map((f) => ({
      id: f.id,
      mag: f.properties.mag as number,
      place: f.properties.place ?? "Unknown location",
      time: new Date(f.properties.time).toISOString(),
      depthKm: f.geometry.coordinates[2],
      lon: f.geometry.coordinates[0],
      lat: f.geometry.coordinates[1],
      url: f.properties.url,
    }))
    .sort((a, b) => b.mag - a.mag);
}

async function fetchQuakes(url: string, source: string): Promise<Earthquake[]> {
  const res = await fetch(url, { next: { revalidate: false } });
  if (res.status === 429) throw new RateLimitError(source);
  if (!res.ok) throw new Error(`${source} responded with ${res.status}`);
  return parseFeed((await res.json()) as UsgsFeed);
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");

  if (date && !DATE_RE.test(date)) {
    return NextResponse.json({ error: "Invalid ?date= (expected YYYY-MM-DD)" }, { status: 400 });
  }

  try {
    let quakes: Earthquake[];

    if (date) {
      // A past date's quake list never changes — cache indefinitely and
      // coalesce concurrent requests for the same date (see lib/serverCache).
      quakes = await cachedFetch(`quakes:${date}`, async () => {
        const start = new Date(`${date}T00:00:00Z`);
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        const params = new URLSearchParams({
          format: "geojson",
          starttime: start.toISOString().slice(0, 10),
          endtime: end.toISOString().slice(0, 10),
          minmagnitude: "4.5",
          orderby: "magnitude",
        });
        return fetchQuakes(`${USGS_QUERY_URL}?${params.toString()}`, "USGS");
      });
    } else {
      // Live feed genuinely changes — no long-lived caching here, just the
      // normal short revalidate window used elsewhere for "current" data.
      const res = await fetch(USGS_LIVE_URL, { next: { revalidate: 300 } });
      if (res.status === 429) throw new RateLimitError("USGS");
      if (!res.ok) throw new Error(`USGS responded with ${res.status}`);
      quakes = parseFeed((await res.json()) as UsgsFeed);
    }

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      date,
      quakes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof RateLimitError ? "Rate limited by USGS" : "Failed to fetch earthquakes from USGS",
        detail: err instanceof Error ? err.message : String(err),
        rateLimited: err instanceof RateLimitError,
      },
      { status: err instanceof RateLimitError ? 429 : 502 }
    );
  }
}
