import { NextResponse } from "next/server";

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

// Magnitude 4.5+, past day — a manageable, genuinely newsworthy set of
// events that keeps the layer live-feeling without drowning the map.
const USGS_URL =
  "https://earthquake.usgs.gov/earthquakes/feed/v1.0/summary/4.5_day.geojson";

export async function GET() {
  try {
    const res = await fetch(USGS_URL, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`USGS responded with ${res.status}`);

    const data = (await res.json()) as UsgsFeed;

    const quakes: Earthquake[] = data.features
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

    return NextResponse.json({
      fetchedAt: new Date().toISOString(),
      quakes,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to fetch earthquakes from USGS",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
