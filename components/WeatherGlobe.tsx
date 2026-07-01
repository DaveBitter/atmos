"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as d3 from "d3-geo";
import { scaleSequential } from "d3-scale";
import { interpolateRdYlBu, interpolateBuPu, interpolateBlues, interpolateRdYlGn } from "d3-scale-chromatic";
import { zoom, zoomIdentity, type ZoomBehavior, type ZoomTransform } from "d3-zoom";
import { select } from "d3-selection";
import "d3-transition";
import { feature } from "topojson-client";
import type { Topology, GeometryCollection } from "topojson-specification";
import type { CityWeather } from "@/app/api/weather/route";
import type { Earthquake } from "@/app/api/earthquakes/route";
import { describeWeather } from "@/lib/weatherCodes";
import DetailPanel from "@/components/DetailPanel";
import CityTable from "@/components/CityTable";

type WeatherResponse = {
  fetchedAt: string;
  cities: CityWeather[];
};

type EarthquakeResponse = {
  fetchedAt: string;
  quakes: Earthquake[];
};

function quakeColor(mag: number) {
  if (mag >= 7) return "#dc2626"; // red-600
  if (mag >= 6) return "#f97316"; // orange-500
  if (mag >= 5.5) return "#f59e0b"; // amber-500
  return "#facc15"; // yellow-400
}

function timeAgo(iso: string) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(diffMs / 60000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

type Metric = "temperature" | "windSpeed" | "precipitation" | "airQuality";
type View = "map" | "table";

const WIDTH = 960;
const HEIGHT = 500;
const REFRESH_MS = 5 * 60 * 1000;

const METRICS: Record<
  Metric,
  {
    label: string;
    unit: string;
    access: (c: CityWeather) => number;
    interpolator: (t: number) => string;
    reverse: boolean;
    fallbackMin: number;
    fallbackMax: number;
  }
> = {
  temperature: {
    label: "Temperature",
    unit: "°C",
    access: (c) => c.temperature,
    interpolator: interpolateRdYlBu,
    reverse: true, // red = hot, blue = cold
    fallbackMin: -10,
    fallbackMax: 35,
  },
  windSpeed: {
    label: "Wind speed",
    unit: "km/h",
    access: (c) => c.windSpeed,
    interpolator: interpolateBuPu,
    reverse: false,
    fallbackMin: 0,
    fallbackMax: 40,
  },
  precipitation: {
    label: "Precipitation",
    unit: "mm",
    access: (c) => c.precipitation,
    interpolator: interpolateBlues,
    reverse: false,
    fallbackMin: 0,
    fallbackMax: 5,
  },
  airQuality: {
    label: "Air quality",
    unit: "US AQI",
    access: (c) => c.aqi,
    interpolator: interpolateRdYlGn,
    reverse: true, // green = clean air, red = poor air (low AQI is good)
    fallbackMin: 0,
    fallbackMax: 150,
  },
};

function useLandPaths() {
  const [landPath, setLandPath] = useState<string | null>(null);
  const [projection, setProjection] = useState<d3.GeoProjection | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const res = await fetch("/land-110m.json");
      const topology = (await res.json()) as Topology;
      const land = feature(
        topology,
        topology.objects.land as GeometryCollection
      );

      const proj = d3
        .geoNaturalEarth1()
        .fitSize([WIDTH, HEIGHT], land as unknown as d3.GeoPermissibleObjects);

      const path = d3.geoPath(proj);

      if (!cancelled) {
        setLandPath(path(land as unknown as d3.GeoPermissibleObjects));
        setProjection(() => proj);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { landPath, projection };
}

function pulseDuration(windSpeed: number) {
  // Faster wind -> faster pulse. Clamp to a sane visual range.
  const clamped = Math.min(Math.max(windSpeed, 0), 40);
  return 3.6 - (clamped / 40) * 2.6; // ~3.6s down to ~1.0s
}

const IDENTITY_TRANSFORM = { x: 0, y: 0, k: 1 };

export default function WeatherGlobe() {
  const { landPath, projection } = useLandPaths();
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<CityWeather | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [metric, setMetric] = useState<Metric>("temperature");
  const [view, setView] = useState<View>("map");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapTransform, setMapTransform] = useState(IDENTITY_TRANSFORM);
  const [quakes, setQuakes] = useState<EarthquakeResponse | null>(null);
  const [quakesError, setQuakesError] = useState<string | null>(null);
  const [showQuakes, setShowQuakes] = useState(true);
  const [hoveredQuake, setHoveredQuake] = useState<Earthquake | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);

  const loadWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
      setData(json);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // Kick off the initial fetch, then poll on an interval. The state update
    // happens inside loadWeather's async continuation, not synchronously here.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadWeather();
    const interval = setInterval(loadWeather, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadWeather]);

  const loadQuakes = useCallback(async () => {
    try {
      const res = await fetch("/api/earthquakes", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
      setQuakes(json);
      setQuakesError(null);
    } catch (err) {
      setQuakesError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadQuakes();
    const interval = setInterval(loadQuakes, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadQuakes]);

  // Wire up pan/zoom once the SVG exists. The map stays mounted (just hidden
  // via CSS) when switching to table view, so this only needs to run once.
  // Zoom deltas arrive in on-screen CSS pixels (based on the element's
  // rendered size), but our map lives in a fixed 960x500 viewBox — so we
  // rescale the translate by the ratio between the two before storing it,
  // keeping panning 1:1 under the cursor.
  useEffect(() => {
    if (!svgRef.current) return;
    const svgEl = svgRef.current;
    const selection = select(svgEl);

    const behavior = zoom<SVGSVGElement, unknown>()
      .scaleExtent([1, 8])
      .on("zoom", (event: { transform: ZoomTransform }) => {
        const rect = svgEl.getBoundingClientRect();
        const ratio = rect.width > 0 ? WIDTH / rect.width : 1;
        const t = event.transform;
        setMapTransform({ x: t.x * ratio, y: t.y * ratio, k: t.k });
      });

    zoomBehaviorRef.current = behavior;
    selection.call(behavior);

    return () => {
      selection.on(".zoom", null);
    };
  }, []);

  function zoomBy(factor: number) {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.scaleBy, factor);
  }

  function resetZoom() {
    if (!svgRef.current || !zoomBehaviorRef.current) return;
    select(svgRef.current)
      .transition()
      .duration(200)
      .call(zoomBehaviorRef.current.transform, zoomIdentity);
  }

  const activeMetric = METRICS[metric];

  const colorScale = useMemo(() => {
    if (!data) return null;
    const values = data.cities.map(activeMetric.access).filter((v) => !Number.isNaN(v));
    const min = Math.min(...values, activeMetric.fallbackMin);
    const max = Math.max(...values, activeMetric.fallbackMax);
    const domain = activeMetric.reverse ? [max, min] : [min, max];
    return { scale: scaleSequential(activeMetric.interpolator).domain(domain as [number, number]), min, max };
  }, [data, activeMetric]);

  const stats = useMemo(() => {
    if (!data) return null;
    const valid = data.cities.filter((c) => !Number.isNaN(c.temperature));
    if (valid.length === 0) return null;
    const warmest = valid.reduce((a, b) => (a.temperature > b.temperature ? a : b));
    const coldest = valid.reduce((a, b) => (a.temperature < b.temperature ? a : b));
    const avg = valid.reduce((sum, c) => sum + c.temperature, 0) / valid.length;
    return { warmest, coldest, avg };
  }, [data]);

  const searchTerm = search.trim().toLowerCase();
  const matches = useCallback(
    (city: CityWeather) =>
      searchTerm === "" ||
      city.name.toLowerCase().includes(searchTerm) ||
      city.country.toLowerCase().includes(searchTerm),
    [searchTerm]
  );

  const filteredCities = useMemo(
    () => (data ? data.cities.filter(matches) : []),
    [data, matches]
  );

  const selectedCity = useMemo(
    () => (data && selectedId ? data.cities.find((c) => c.id === selectedId) ?? null : null),
    [data, selectedId]
  );

  function handleSelect(city: CityWeather) {
    setSelectedId((current) => (current === city.id ? null : city.id));
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const ready = landPath && projection && data && colorScale;
  const legendStops = colorScale
    ? [0, 0.25, 0.5, 0.75, 1].map((t) =>
        colorScale.scale(colorScale.min + t * (colorScale.max - colorScale.min))
      )
    : [];

  return (
    <div className="relative h-full w-full overflow-hidden bg-slate-950">
      {/* Map layer: stays mounted (just hidden) when the table view is active,
          so pan/zoom state and the D3 zoom listener survive toggling. */}
      <div
        ref={containerRef}
        onMouseMove={handleMouseMove}
        className={`absolute inset-0 ${view === "map" ? "" : "invisible"}`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          preserveAspectRatio="xMidYMid slice"
          className="h-full w-full block touch-none"
        >
          <defs>
            <radialGradient id="bgGlow" cx="50%" cy="35%" r="75%">
              <stop offset="0%" stopColor="#111827" />
              <stop offset="100%" stopColor="#020617" />
            </radialGradient>
          </defs>
          <rect x={0} y={0} width={WIDTH} height={HEIGHT} fill="url(#bgGlow)" />

          {ready && (
            <g transform={`translate(${mapTransform.x}, ${mapTransform.y}) scale(${mapTransform.k})`}>
              <path d={landPath ?? undefined} fill="#1e293b" stroke="#334155" strokeWidth={0.6 / mapTransform.k} />

              {showQuakes &&
                quakes?.quakes.map((q) => {
                  const coords = projection!([q.lon, q.lat]);
                  if (!coords) return null;
                  const [x, y] = coords;
                  const color = quakeColor(q.mag);
                  const baseR = 3 + Math.min(Math.max(q.mag - 4.5, 0), 3.5) * 2.4;
                  // Bigger quakes ripple slower and further, so scale reads as severity.
                  const duration = 1.6 + Math.min(Math.max(q.mag - 4.5, 0), 3.5) * 0.5;

                  return (
                    <g
                      key={q.id}
                      transform={`translate(${x}, ${y})`}
                      onMouseEnter={() => setHoveredQuake(q)}
                      onMouseLeave={() => setHoveredQuake((h) => (h?.id === q.id ? null : h))}
                      style={{ cursor: "pointer" }}
                    >
                      <g transform={`scale(${1 / mapTransform.k})`}>
                        <circle
                          r={baseR}
                          fill="none"
                          stroke={color}
                          strokeWidth={1.5}
                          className="quake-ripple"
                          style={{
                            ["--ripple-duration" as string]: `${duration}s`,
                            ["--ripple-delay" as string]: `${(q.id.charCodeAt(0) % 5) * 0.3}s`,
                          }}
                        />
                        <circle r={2} fill={color} opacity={0.9} />
                      </g>
                    </g>
                  );
                })}

              {data!.cities.map((city) => {
                const coords = projection!([city.lon, city.lat]);
                if (!coords) return null;
                const [x, y] = coords;
                const value = activeMetric.access(city);
                const color = Number.isNaN(value) ? "#64748b" : colorScale!.scale(value);
                const weather = describeWeather(city.weatherCode);
                const radius = 4 + Math.min(Math.max(city.windSpeed, 0), 40) / 10;
                const duration = pulseDuration(city.windSpeed);
                const raining = city.precipitation > 0.1;
                const dimmed = !matches(city);
                const isSelected = city.id === selectedId;

                return (
                  <g
                    key={city.id}
                    transform={`translate(${x}, ${y})`}
                    onMouseEnter={() => setHovered(city)}
                    onMouseLeave={() => setHovered((h) => (h?.id === city.id ? null : h))}
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelect(city);
                    }}
                    style={{ cursor: "pointer" }}
                    opacity={dimmed ? 0.15 : 1}
                  >
                    {/* Counter-scale so orbs stay a constant screen size while
                        zoomed in/out — only their position should move with
                        the map, not their radius (otherwise zooming in makes
                        every orb balloon up and the map gets cluttered). */}
                    <g transform={`scale(${1 / mapTransform.k})`}>
                      <circle
                        r={radius * 2.4}
                        fill={color}
                        opacity={city.isDay ? 0.18 : 0.28}
                        className="orb-pulse"
                        style={{ ["--pulse-duration" as string]: `${duration}s` }}
                      />
                      {isSelected && (
                        <circle r={radius + 4} fill="none" stroke="#f8fafc" strokeWidth={1.25} opacity={0.9} />
                      )}
                      <circle
                        r={radius}
                        fill={color}
                        stroke={city.isDay ? "#fff" : "#0ea5e9"}
                        strokeOpacity={city.isDay ? 0.5 : 0.8}
                        strokeWidth={city.isDay ? 0.75 : 1.25}
                      />
                      {raining && (
                        <g className="rain-drop" opacity={0.85}>
                          <line x1={-2} y1={radius + 2} x2={-2} y2={radius + 6} stroke="#38bdf8" strokeWidth={1} />
                          <line x1={2} y1={radius + 4} x2={2} y2={radius + 8} stroke="#38bdf8" strokeWidth={1} />
                        </g>
                      )}
                      <text textAnchor="middle" y={-radius - 6} fontSize={9} fill="#cbd5e1" opacity={0.85}>
                        {weather.emoji}
                      </text>
                    </g>
                  </g>
                );
              })}
            </g>
          )}
        </svg>

        {view === "map" && hovered && (
          <div
            className="pointer-events-none absolute z-20 max-w-[220px] rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur-md"
            style={{ left: mouse.x + 14, top: mouse.y + 14 }}
          >
            <div className="font-semibold">
              {hovered.name}, {hovered.country}
            </div>
            <div className="text-slate-300">
              {describeWeather(hovered.weatherCode).emoji} {describeWeather(hovered.weatherCode).label}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-slate-400">
              <span>Temp</span>
              <span className="text-slate-100">
                {Number.isNaN(hovered.temperature) ? "—" : `${hovered.temperature.toFixed(1)}°C`}
              </span>
              <span>Wind</span>
              <span className="text-slate-100">{hovered.windSpeed.toFixed(0)} km/h</span>
              <span>Precip</span>
              <span className="text-slate-100">{hovered.precipitation.toFixed(1)} mm</span>
              <span>Air quality</span>
              <span className="text-slate-100">{Number.isNaN(hovered.aqi) ? "—" : `${hovered.aqi.toFixed(0)} AQI`}</span>
              <span>Local</span>
              <span className="text-slate-100">{hovered.isDay ? "Day" : "Night"}</span>
            </div>
            <div className="mt-1 text-[10px] text-slate-500">Click to pin details →</div>
          </div>
        )}

        {view === "map" && !hovered && hoveredQuake && (
          <div
            className="pointer-events-none absolute z-20 max-w-[220px] rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur-md"
            style={{ left: mouse.x + 14, top: mouse.y + 14 }}
          >
            <div className="font-semibold">M {hoveredQuake.mag.toFixed(1)} earthquake</div>
            <div className="text-slate-300">{hoveredQuake.place}</div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-slate-400">
              <span>Depth</span>
              <span className="text-slate-100">{hoveredQuake.depthKm.toFixed(0)} km</span>
              <span>When</span>
              <span className="text-slate-100">{timeAgo(hoveredQuake.time)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Table view: floats above the (hidden) map as a full overlay panel. */}
      {view === "table" && (
        <div className="absolute inset-x-4 bottom-4 top-28 z-30 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/95 p-3 backdrop-blur sm:inset-x-8 sm:top-32">
          <CityTable cities={filteredCities} selectedId={selectedId} onSelect={handleSelect} />
        </div>
      )}

      {/* Top overlay bar: title/stats on the left, controls on the right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
        <div className="pointer-events-auto max-w-md rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur">
          <h1 className="text-lg font-semibold tracking-tight text-slate-100">
            🌍 Atmos — a live pulse of the planet
          </h1>
          <div className="mt-1 text-xs text-slate-400">
            {stats ? (
              <span>
                🔥 {stats.warmest.name} {stats.warmest.temperature.toFixed(1)}°C
                {"  ·  "}
                🧊 {stats.coldest.name} {stats.coldest.temperature.toFixed(1)}°C
                {"  ·  "}
                Avg {stats.avg.toFixed(1)}°C
              </span>
            ) : (
              <span>Loading live weather…</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            {data && <span>Updated {new Date(data.fetchedAt).toLocaleTimeString()}</span>}
            <button
              onClick={loadWeather}
              className="pointer-events-auto rounded-full border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800 transition-colors"
            >
              Refresh
            </button>
          </div>
        </div>

        <div className="pointer-events-auto flex flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur">
          <div className="flex items-center gap-1 rounded-full border border-slate-700 p-1">
            {(Object.keys(METRICS) as Metric[]).map((key) => (
              <button
                key={key}
                onClick={() => setMetric(key)}
                className={`rounded-full px-3 py-1 text-xs transition-colors ${
                  metric === key ? "bg-slate-100 text-slate-900" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {METRICS[key].label}
              </button>
            ))}
          </div>

          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search city or country…"
            className="w-40 rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:ring-1 focus:ring-slate-500"
          />

          <div className="flex items-center gap-1 rounded-full border border-slate-700 p-1">
            {(["map", "table"] as View[]).map((v) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={`rounded-full px-3 py-1 text-xs capitalize transition-colors ${
                  view === v ? "bg-slate-100 text-slate-900" : "text-slate-300 hover:bg-slate-800"
                }`}
              >
                {v}
              </button>
            ))}
          </div>

          <button
            onClick={() => setShowQuakes((v) => !v)}
            title={quakesError ? `Couldn't load earthquakes: ${quakesError}` : undefined}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              showQuakes
                ? "border-amber-600/60 bg-amber-500/20 text-amber-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            🌎 Quakes{quakes ? ` (${quakes.quakes.length})` : ""}
          </button>
        </div>
      </div>

      {error && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 w-full max-w-md -translate-x-1/2 px-4">
          <div className="pointer-events-auto rounded-md border border-red-800 bg-red-950/90 px-3 py-2 text-center text-sm text-red-300 backdrop-blur">
            Couldn&apos;t reach Open-Meteo: {error}
          </div>
        </div>
      )}

      {view === "map" && (
        <>
          <div className="pointer-events-auto absolute right-3 bottom-3 z-30 flex flex-col gap-1">
            <button
              onClick={() => zoomBy(1.5)}
              aria-label="Zoom in"
              className="h-7 w-7 rounded-md border border-slate-700 bg-slate-900/90 text-sm text-slate-200 hover:bg-slate-800"
            >
              +
            </button>
            <button
              onClick={() => zoomBy(1 / 1.5)}
              aria-label="Zoom out"
              className="h-7 w-7 rounded-md border border-slate-700 bg-slate-900/90 text-sm text-slate-200 hover:bg-slate-800"
            >
              −
            </button>
            <button
              onClick={resetZoom}
              aria-label="Reset zoom"
              className="h-7 w-7 rounded-md border border-slate-700 bg-slate-900/90 text-[10px] text-slate-200 hover:bg-slate-800"
            >
              ⟲
            </button>
          </div>

          <div className="pointer-events-none absolute bottom-3 left-3 z-30 flex flex-col gap-2">
            {colorScale && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300">
                <div className="mb-1">
                  {activeMetric.label} ({activeMetric.unit})
                </div>
                <div
                  className="h-2 w-32 rounded-full"
                  style={{ background: `linear-gradient(to right, ${legendStops.join(", ")})` }}
                />
                <div className="mt-0.5 flex justify-between">
                  <span>{colorScale.min.toFixed(0)}</span>
                  <span>{colorScale.max.toFixed(0)}</span>
                </div>
              </div>
            )}

            {showQuakes && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300">
                <div className="mb-1">🌎 M4.5+ earthquakes (24h)</div>
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: quakeColor(4.5) }} />
                    M4.5
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block h-2 w-2 rounded-full" style={{ background: quakeColor(7) }} />
                    M7+
                  </span>
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {selectedCity && (
        <div className="absolute right-4 top-28 bottom-4 z-40 w-[340px] max-w-[90vw] overflow-y-auto sm:top-32">
          <DetailPanel city={selectedCity} onClose={() => setSelectedId(null)} />
        </div>
      )}
    </div>
  );
}
