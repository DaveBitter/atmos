"use client";

import { useEffect, useMemo, useState } from "react";
import { scaleLinear, scaleTime } from "d3-scale";
import { extent, max } from "d3-array";
import { X } from "lucide-react";
import type { CityWeather } from "@/app/api/weather/route";
import type { HourlyForecast } from "@/app/api/forecast/[id]/route";
import type { DailySnapshot } from "@/app/api/history/route";
import { describeWeather } from "@/lib/weatherCodes";
import { describeAqi } from "@/lib/airQuality";
import { type UnitSystem, formatTemperature, formatWind, formatPrecip, celsiusToFahrenheit } from "@/lib/units";
import { formatFullDate, formatTimeOnly } from "@/lib/time";

const CHART_WIDTH = 320;
const CHART_HEIGHT = 130;
const CHART_PAD = { top: 10, right: 12, bottom: 18, left: 28 };

export default function DetailPanel({
  city,
  onClose,
  historySnapshot,
  units,
}: {
  city: CityWeather;
  onClose: () => void;
  // When set, we're looking at a historical date rather than "now" — show a
  // daily summary instead of fetching/rendering the next-24h forecast.
  historySnapshot?: DailySnapshot | null;
  units: UnitSystem;
}) {
  const [forecast, setForecast] = useState<HourlyForecast | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!historySnapshot);

  useEffect(() => {
    if (historySnapshot) return;
    let cancelled = false;
    // Reset panel state synchronously when the selected city changes, before
    // kicking off the async fetch below (whose own setState calls happen in
    // promise continuations, not synchronously in the effect body).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setForecast(null);
    setError(null);

    fetch(`/api/forecast/${city.id}`, { cache: "no-store" })
      .then(async (res) => {
        const json = await res.json();
        if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
        if (!cancelled) setForecast(json);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [city.id, historySnapshot]);

  const chart = useMemo(() => {
    if (!forecast || forecast.hours.length === 0) return null;

    const times = forecast.hours.map((h) => new Date(h.time));
    const temps = forecast.hours.map((h) => h.temperature);
    const precs = forecast.hours.map((h) => h.precipitation);

    const [tMin, tMax] = extent(times) as [Date, Date];
    const [vMin, vMax] = extent(temps) as [number, number];
    const precMax = Math.max(max(precs) ?? 0, 1);

    const x = scaleTime()
      .domain([tMin, tMax])
      .range([CHART_PAD.left, CHART_WIDTH - CHART_PAD.right]);

    const y = scaleLinear()
      .domain([vMin - 1, vMax + 1])
      .range([CHART_HEIGHT - CHART_PAD.bottom, CHART_PAD.top]);

    const barBase = CHART_HEIGHT - CHART_PAD.bottom;
    const barMaxHeight = 22;
    const yPrecip = scaleLinear().domain([0, precMax]).range([0, barMaxHeight]);

    const linePath = forecast.hours
      .map((h, i) => {
        const px = x(new Date(h.time));
        const py = y(h.temperature);
        return `${i === 0 ? "M" : "L"}${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(" ");

    return { x, y, yPrecip, barBase, linePath, tMin, tMax, vMin, vMax };
  }, [forecast]);

  const weather = describeWeather(city.weatherCode);

  return (
    <div className="w-full lg:w-[340px] shrink-0 rounded-2xl border border-slate-800 bg-slate-950/90 p-4 shadow-2xl backdrop-blur-md">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-lg font-semibold text-slate-100">
            {city.name}, {city.country}
          </div>
          <div className="flex items-center gap-1.5 text-sm text-slate-400">
            <weather.icon size={14} />
            {weather.label}
          </div>
        </div>
        <button
          onClick={onClose}
          aria-label="Close detail panel"
          className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-700 text-slate-300 hover:bg-slate-800 transition-colors"
        >
          <X size={14} />
        </button>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-y-1 text-sm text-slate-400">
        <span>{historySnapshot ? "Avg temperature" : "Temperature"}</span>
        <span className="text-right text-slate-100">{formatTemperature(city.temperature, units)}</span>
        <span>{historySnapshot ? "Max wind" : "Wind"}</span>
        <span className="text-right text-slate-100">{formatWind(city.windSpeed, units)}</span>
        <span>Precipitation</span>
        <span className="text-right text-slate-100">{formatPrecip(city.precipitation, units)}</span>

        {historySnapshot ? (
          <>
            <span>Date</span>
            <span className="text-right text-slate-100">{formatFullDate(historySnapshot.date)}</span>
          </>
        ) : (
          <>
            <span>Air quality</span>
            <span className="flex items-center justify-end gap-1.5 text-right text-slate-100">
              {Number.isNaN(city.aqi) ? (
                "—"
              ) : (
                <>
                  {city.aqi.toFixed(0)} ·
                  <span
                    className="inline-block h-2 w-2 rounded-full"
                    style={{ background: describeAqi(city.aqi).color }}
                  />
                  {describeAqi(city.aqi).label}
                </>
              )}
            </span>
            <span>PM2.5</span>
            <span className="text-right text-slate-100">
              {Number.isNaN(city.pm25) ? "—" : `${city.pm25.toFixed(1)} µg/m³`}
            </span>
            <span>Local time</span>
            <span className="text-right text-slate-100">{city.isDay ? "Day" : "Night"}</span>
          </>
        )}

        <span>Coordinates</span>
        <span className="text-right text-slate-100">
          {city.lat.toFixed(1)}, {city.lon.toFixed(1)}
        </span>
      </div>

      {historySnapshot ? (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Daily summary</div>
          <div className="grid grid-cols-2 gap-2 rounded-lg border border-slate-800 bg-slate-900/60 p-3 text-sm">
            <div>
              <div className="text-[10px] uppercase text-slate-500">High</div>
              <div className="text-slate-100">{formatTemperature(historySnapshot.tempMax, units)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Low</div>
              <div className="text-slate-100">{formatTemperature(historySnapshot.tempMin, units)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Max wind</div>
              <div className="text-slate-100">{formatWind(historySnapshot.windMax, units)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase text-slate-500">Precip total</div>
              <div className="text-slate-100">{formatPrecip(historySnapshot.precipSum, units)}</div>
            </div>
          </div>
          <div className="mt-2 text-[10px] text-slate-500">
            Historical daily aggregate from Open-Meteo&apos;s archive (ERA5 reanalysis).
          </div>
        </div>
      ) : (
        <div className="mt-4">
          <div className="mb-1 text-xs uppercase tracking-wide text-slate-500">Next 24 hours</div>

          {loading && <div className="py-6 text-center text-xs text-slate-500">Loading forecast…</div>}

          {error && (
            <div className="rounded-md border border-red-800 bg-red-950/50 px-2 py-2 text-xs text-red-300">
              Couldn&apos;t load forecast: {error}
            </div>
          )}

          {chart && (
            <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} className="w-full h-auto">
              {/* precipitation bars */}
              {forecast!.hours.map((h, i) => {
                const px = chart.x(new Date(h.time));
                const barH = chart.yPrecip(h.precipitation);
                if (barH <= 0) return null;
                return (
                  <rect
                    key={`bar-${i}`}
                    x={px - 1.5}
                    y={chart.barBase - barH}
                    width={3}
                    height={barH}
                    fill="#38bdf8"
                    opacity={0.5}
                  />
                );
              })}

              {/* temperature line */}
              <path d={chart.linePath} fill="none" stroke="#fb923c" strokeWidth={1.75} />

              {/* axis labels */}
              <text x={CHART_PAD.left} y={CHART_HEIGHT - 2} fontSize={9} fill="#64748b">
                {formatTimeOnly(chart.tMin.toISOString())}
              </text>
              <text
                x={CHART_WIDTH - CHART_PAD.right}
                y={CHART_HEIGHT - 2}
                fontSize={9}
                fill="#64748b"
                textAnchor="end"
              >
                {formatTimeOnly(chart.tMax.toISOString())}
              </text>
              <text x={2} y={CHART_PAD.top + 4} fontSize={9} fill="#64748b">
                {(units === "metric" ? chart.vMax : celsiusToFahrenheit(chart.vMax)).toFixed(0)}°
              </text>
              <text x={2} y={CHART_HEIGHT - CHART_PAD.bottom} fontSize={9} fill="#64748b">
                {(units === "metric" ? chart.vMin : celsiusToFahrenheit(chart.vMin)).toFixed(0)}°
              </text>
            </svg>
          )}

          <div className="mt-1 flex items-center gap-3 text-[10px] text-slate-500">
            <span className="flex items-center gap-1">
              <span className="inline-block h-0.5 w-3 bg-orange-400" /> Temp
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-1 bg-sky-400/60" /> Precip
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
