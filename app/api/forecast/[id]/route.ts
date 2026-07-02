import { NextResponse } from "next/server";
import { CITIES } from "@/lib/cities";

export type HourlyForecast = {
  cityId: string;
  hours: {
    time: string;
    temperature: number;
    precipitation: number;
  }[];
};

type OpenMeteoHourlyResponse = {
  hourly: {
    time: string[];
    temperature_2m: number[];
    precipitation: number[];
  };
};

const OPEN_METEO_URL = "https://api.open-meteo.com/v1/forecast";
const HOURS_AHEAD = 24;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const city = CITIES.find((c) => c.id === id);

  if (!city) {
    return NextResponse.json({ error: `Unknown city id "${id}"` }, { status: 404 });
  }

  const url = `${OPEN_METEO_URL}?latitude=${city.lat}&longitude=${city.lon}&hourly=temperature_2m,precipitation&forecast_days=2&timezone=auto`;

  try {
    const res = await fetch(url, { next: { revalidate: 900 } });
    if (!res.ok) throw new Error(`Open-Meteo responded with ${res.status}`);

    const data = (await res.json()) as OpenMeteoHourlyResponse;
    const now = Date.now();

    // Open-Meteo returns local ISO timestamps without a timezone suffix
    // (already adjusted via timezone=auto), so plain Date parsing lines up.
    const allHours = data.hourly.time.map((time, i) => ({
      time,
      temperature: data.hourly.temperature_2m[i],
      precipitation: data.hourly.precipitation[i],
    }));

    const upcoming = allHours.filter((h) => new Date(h.time).getTime() >= now - 60 * 60 * 1000);
    const hours = upcoming.slice(0, HOURS_AHEAD);

    const forecast: HourlyForecast = { cityId: id, hours };
    return NextResponse.json(forecast, {
      headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=120" },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error: "Failed to fetch hourly forecast from Open-Meteo",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 502 }
    );
  }
}
