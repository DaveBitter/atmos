import { ImageResponse } from "next/og";
import { CITIES } from "@/lib/cities";

// Regenerate at request time rather than trying to bake live weather data
// into a static build artifact.
export const dynamic = "force-dynamic";

export const alt = "Atmos — check in on earth once in a while";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// A handful of spread-out cities so the OG image stays fast to generate.
// Fetched directly from Open-Meteo (rather than round-tripping through our
// own /api/weather route) since image routes don't have a reliable
// self-referencing base URL to call at request time.
const HEADLINE_CITY_IDS = ["ams", "cai", "dxb", "tok", "syd", "lax", "rio", "nai"];

export default async function OgImage() {
  const headline = CITIES.filter((c) => HEADLINE_CITY_IDS.includes(c.id));
  let warmest: { name: string; temp: number } | null = null;
  let coldest: { name: string; temp: number } | null = null;

  try {
    const lats = headline.map((c) => c.lat).join(",");
    const lons = headline.map((c) => c.lon).join(",");
    const res = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lats}&longitude=${lons}&current=temperature_2m&timezone=auto`,
      { next: { revalidate: 1800 } }
    );

    if (res.ok) {
      const data = await res.json();
      const results = Array.isArray(data) ? data : [data];
      const temps = headline
        .map((c, i) => ({ name: c.name, temp: results[i]?.current?.temperature_2m as number | undefined }))
        .filter((t): t is { name: string; temp: number } => typeof t.temp === "number");

      if (temps.length > 0) {
        warmest = temps.reduce((a, b) => (b.temp > a.temp ? b : a));
        coldest = temps.reduce((a, b) => (b.temp < a.temp ? b : a));
      }
    }
  } catch {
    // Live stats are a bonus — fall back to a plain tagline card below.
  }

  return new ImageResponse(
    (
      <div
        style={{
          height: "100%",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #111827 0%, #020617 100%)",
          color: "#f8fafc",
          fontFamily: "sans-serif",
          padding: 80,
          position: "relative",
        }}
      >
        {/* decorative orbs, echoing the map's city markers */}
        <div style={{ position: "absolute", top: 90, left: 120, display: "flex", width: 26, height: 26, borderRadius: 999, background: "#fb923c" }} />
        <div style={{ position: "absolute", top: 160, left: 220, display: "flex", width: 14, height: 14, borderRadius: 999, background: "#38bdf8" }} />
        <div style={{ position: "absolute", bottom: 120, right: 160, display: "flex", width: 30, height: 30, borderRadius: 999, background: "#f87171" }} />
        <div style={{ position: "absolute", bottom: 80, right: 260, display: "flex", width: 16, height: 16, borderRadius: 999, background: "#4ade80" }} />

        <div style={{ display: "flex", fontSize: 88, fontWeight: 700 }}>Atmos</div>
        <div style={{ display: "flex", fontSize: 34, color: "#cbd5e1", marginTop: 20, textAlign: "center" }}>
          Check in on earth once in a while
        </div>
        <div style={{ display: "flex", fontSize: 22, color: "#64748b", marginTop: 14 }}>
          Weather · Air quality · Earthquakes · Time travel to 1940
        </div>

        {warmest && coldest && (
          <div style={{ display: "flex", marginTop: 48, fontSize: 26, color: "#94a3b8" }}>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#f87171", marginRight: 10 }} />
              Warmest {warmest.name} {Math.round(warmest.temp)}°C
            </div>
            <div style={{ display: "flex", margin: "0 24px" }}>·</div>
            <div style={{ display: "flex", alignItems: "center" }}>
              <span style={{ display: "flex", width: 12, height: 12, borderRadius: 999, background: "#38bdf8", marginRight: 10 }} />
              Coldest {coldest.name} {Math.round(coldest.temp)}°C
            </div>
          </div>
        )}
      </div>
    ),
    { ...size }
  );
}
