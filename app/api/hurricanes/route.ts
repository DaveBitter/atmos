import { NextResponse } from "next/server";

export type Hurricane = {
  id: string;
  name: string;
  classification: string; // TD, STD, TS, HU, STS, PTC, TY, PC
  kind: string; // human-readable version of classification
  category: number | null; // Saffir-Simpson 1-5, only set for HU/TY
  intensityKt: number | null;
  windMph: number | null;
  pressureMb: number | null;
  lat: number;
  lon: number;
  movementDir: number | null; // degrees from true north
  movementSpeedMph: number | null;
  lastUpdate: string;
  advisoryUrl: string | null;
};

// NHC's schema has drifted a bit over the years (their 2019 reference PDF
// documents snake_case latitude_numeric/longitude_numeric, but their more
// recent example code uses camelCase latitudeNumeric/longitudeNumeric) —
// accept either so this doesn't silently break if the feed changes again.
type RawStorm = {
  id: string;
  name: string;
  classification: string;
  intensity?: number | null;
  pressure?: number | null;
  latitudeNumeric?: number;
  latitude_numeric?: number;
  longitudeNumeric?: number;
  longitude_numeric?: number;
  movementDir?: number | null;
  movementSpeed?: number | null;
  lastUpdate: string;
  publicAdvisory?: { url?: string } | null;
};

type CurrentStormsResponse = {
  activeStorms: RawStorm[];
};

// NHC's free, keyless "current storms" feed — Atlantic + Eastern/Central
// Pacific active tropical cyclones. There is no equivalent free, queryable
// API for arbitrary historical dates (NOAA's IBTrACS best-track archive is
// bulk CSV/NetCDF, not a per-date REST endpoint), so unlike earthquakes this
// layer is live-only for now.
const NHC_URL = "https://www.nhc.noaa.gov/CurrentStorms.json";

const CLASSIFICATION_LABELS: Record<string, string> = {
  TD: "Tropical Depression",
  STD: "Subtropical Depression",
  TS: "Tropical Storm",
  HU: "Hurricane",
  STS: "Subtropical Storm",
  PTC: "Post-tropical Cyclone",
  TY: "Typhoon",
  PC: "Potential Tropical Cyclone",
};

const KT_TO_MPH = 1.15078;

function saffirSimpsonCategory(classification: string, knots: number | null): number | null {
  if ((classification !== "HU" && classification !== "TY") || knots === null) return null;
  if (knots >= 137) return 5;
  if (knots >= 113) return 4;
  if (knots >= 96) return 3;
  if (knots >= 83) return 2;
  if (knots >= 64) return 1;
  return null;
}

export async function GET() {
  try {
    const res = await fetch(NHC_URL, { next: { revalidate: 300 } });
    if (!res.ok) throw new Error(`NHC responded with ${res.status}`);

    const data = (await res.json()) as CurrentStormsResponse;

    const storms: Hurricane[] = (data.activeStorms ?? [])
      .map((s): Hurricane => {
        const lat = s.latitudeNumeric ?? s.latitude_numeric ?? NaN;
        const lon = s.longitudeNumeric ?? s.longitude_numeric ?? NaN;
        const intensityKt = typeof s.intensity === "number" ? s.intensity : null;
        return {
          id: s.id,
          name: s.name,
          classification: s.classification,
          kind: CLASSIFICATION_LABELS[s.classification] ?? s.classification,
          category: saffirSimpsonCategory(s.classification, intensityKt),
          intensityKt,
          windMph: intensityKt !== null ? Math.round(intensityKt * KT_TO_MPH) : null,
          pressureMb: typeof s.pressure === "number" ? s.pressure : null,
          lat,
          lon,
          movementDir: typeof s.movementDir === "number" ? s.movementDir : null,
          movementSpeedMph: typeof s.movementSpeed === "number" ? s.movementSpeed : null,
          lastUpdate: s.lastUpdate,
          advisoryUrl: s.publicAdvisory?.url ?? null,
        };
      })
      .filter((s) => Number.isFinite(s.lat) && Number.isFinite(s.lon));

    return NextResponse.json(
      { fetchedAt: new Date().toISOString(), storms },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=60" } }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to fetch active storms from NHC",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
