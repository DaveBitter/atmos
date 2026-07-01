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
import {
  Globe,
  Flame,
  Snowflake,
  Activity,
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RefreshCw,
  Play,
  Pause,
  History,
  Thermometer,
  Tornado,
  SlidersHorizontal,
  Layers,
  X,
} from "lucide-react";
import type { CityWeather } from "@/app/api/weather/route";
import type { Earthquake } from "@/app/api/earthquakes/route";
import type { Hurricane } from "@/app/api/hurricanes/route";
import type { DailySnapshot } from "@/app/api/history/route";
import { CITIES } from "@/lib/cities";
import { describeWeather } from "@/lib/weatherCodes";
import {
  estimateIsDay,
  findNearestHourIndex,
  formatScrubTime,
  formatAbsoluteDateTime,
  formatRelativeTime,
  formatMonthYear,
  formatWeekday,
  formatTimeOnly,
} from "@/lib/time";
import {
  type UnitSystem,
  formatTemperature,
  formatWind,
  formatPrecip,
  formatDistance,
  formatWindFromMph,
  temperatureUnitLabel,
  windUnitLabel,
  precipUnitLabel,
  convertMetricValue,
} from "@/lib/units";
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

type HurricaneResponse = {
  fetchedAt: string;
  storms: Hurricane[];
};

function isRateLimited(msg: string | null) {
  return !!msg && /429|rate.?limit/i.test(msg);
}

function quakeColor(mag: number) {
  if (mag >= 7) return "#dc2626"; // red-600
  if (mag >= 6) return "#f97316"; // orange-500
  if (mag >= 5.5) return "#f59e0b"; // amber-500
  return "#facc15"; // yellow-400
}

// Roughly Saffir-Simpson-coded: gray for depressions, cyan for (sub)tropical
// storms, escalating yellow -> purple through hurricane categories 1-5.
function hurricaneColor(classification: string, category: number | null) {
  if (classification === "HU" || classification === "TY") {
    switch (category) {
      case 5:
        return "#a21caf"; // fuchsia-700
      case 4:
        return "#c026d3"; // fuchsia-600
      case 3:
        return "#dc2626"; // red-600
      case 2:
        return "#f97316"; // orange-500
      default:
        return "#f59e0b"; // amber-500 (cat 1 or unknown)
    }
  }
  if (classification === "TS" || classification === "STS") return "#22d3ee"; // cyan-400
  if (classification === "PTC") return "#94a3b8"; // slate-400
  return "#64748b"; // TD / STD / PC — slate-500
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
    unit: (units: UnitSystem) => string;
    // Metric key for lib/units' convertMetricValue, or null if the metric
    // has no imperial equivalent (e.g. AQI).
    unitsMetric: "temperature" | "windSpeed" | "precipitation" | null;
    access: (c: CityWeather) => number;
    interpolator: (t: number) => string;
    reverse: boolean;
    fallbackMin: number;
    fallbackMax: number;
  }
> = {
  temperature: {
    label: "Temperature",
    unit: temperatureUnitLabel,
    unitsMetric: "temperature",
    access: (c) => c.temperature,
    interpolator: interpolateRdYlBu,
    reverse: true, // red = hot, blue = cold
    fallbackMin: -10,
    fallbackMax: 35,
  },
  windSpeed: {
    label: "Wind speed",
    unit: windUnitLabel,
    unitsMetric: "windSpeed",
    access: (c) => c.windSpeed,
    interpolator: interpolateBuPu,
    reverse: false,
    fallbackMin: 0,
    fallbackMax: 40,
  },
  precipitation: {
    label: "Precipitation",
    unit: precipUnitLabel,
    unitsMetric: "precipitation",
    access: (c) => c.precipitation,
    interpolator: interpolateBlues,
    reverse: false,
    fallbackMin: 0,
    fallbackMax: 5,
  },
  airQuality: {
    label: "Air quality",
    unit: () => "US AQI",
    unitsMetric: null,
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

const HISTORY_START_YEAR = 1940; // Open-Meteo's ERA5 archive begins here.

type MonthlyEntry = { date: string }; // YYYY-MM-01, UTC

// One entry per month from 1940-01 up to (but not including) the month the
// recent hourly window starts in — the "deep history, lower resolution"
// half of the combined timeline.
function buildMonthlyEntries(hourlyStartIso: string | undefined): MonthlyEntry[] {
  if (!hourlyStartIso) return [];
  const hourlyStart = new Date(hourlyStartIso);
  const stopYear = hourlyStart.getUTCFullYear();
  const stopMonth = hourlyStart.getUTCMonth();

  const entries: MonthlyEntry[] = [];
  for (let y = HISTORY_START_YEAR; y <= stopYear; y++) {
    const lastMonth = y === stopYear ? stopMonth - 1 : 11;
    for (let m = 0; m <= lastMonth; m++) {
      entries.push({ date: `${y}-${String(m + 1).padStart(2, "0")}-01` });
    }
  }
  return entries;
}

export default function WeatherGlobe() {
  const { landPath, projection } = useLandPaths();
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hovered, setHovered] = useState<CityWeather | null>(null);
  const [mouse, setMouse] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [metric, setMetric] = useState<Metric>("temperature");
  const [units, setUnits] = useState<UnitSystem>("metric");
  const [view, setView] = useState<View>("map");
  const [search, setSearch] = useState("");
  // Both panels are collapsed behind a toggle button on mobile (see the
  // md:flex overrides below) so the map gets real screen space instead of
  // being squeezed into a sliver by stacked full-width controls.
  const [showControlsPanel, setShowControlsPanel] = useState(false);
  const [showLegendPanel, setShowLegendPanel] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [mapTransform, setMapTransform] = useState(IDENTITY_TRANSFORM);
  const [quakes, setQuakes] = useState<EarthquakeResponse | null>(null);
  const [quakesError, setQuakesError] = useState<string | null>(null);
  const [showQuakes, setShowQuakes] = useState(true);
  const [hoveredQuake, setHoveredQuake] = useState<Earthquake | null>(null);
  // Active storms are live-only — NHC's free feed has no historical/by-date
  // query, unlike the USGS earthquake feed — so this only ever shows what's
  // active right now, regardless of where the scrubber is.
  const [hurricanes, setHurricanes] = useState<HurricaneResponse | null>(null);
  const [hurricanesError, setHurricanesError] = useState<string | null>(null);
  const [showHurricanes, setShowHurricanes] = useState(true);
  const [hoveredHurricane, setHoveredHurricane] = useState<Hurricane | null>(null);
  // scrubIndex is null when following live data, otherwise an index into the
  // COMBINED timeline: monthly deep-history entries (1940 -> just before the
  // recent window) followed by hourly entries (past 48h -> next 24h). One
  // slider, one index space, two resolutions.
  const [scrubIndex, setScrubIndex] = useState<number | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [liveIndex, setLiveIndex] = useState(-1); // index within the hourly-only window
  const [historySnapshots, setHistorySnapshots] = useState<DailySnapshot[] | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  // Last non-empty effectiveCities snapshot — used as a stale-while-loading
  // fallback so the map never goes blank mid-scrub (see effectiveCities below).
  // State rather than a ref, since refs can't be read during render.
  const [lastGoodCities, setLastGoodCities] = useState<CityWeather[]>([]);

  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const zoomBehaviorRef = useRef<ZoomBehavior<SVGSVGElement, unknown> | null>(null);
  const historyCacheRef = useRef<Map<string, DailySnapshot[]>>(new Map());

  // Restore the user's unit preference (localStorage isn't available during
  // SSR, so this only runs client-side, after the initial "metric" render).
  useEffect(() => {
    const stored = window.localStorage.getItem("atmos:units");
    if (stored === "metric" || stored === "imperial") {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setUnits(stored);
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("atmos:units", units);
  }, [units]);

  const loadWeather = useCallback(async () => {
    try {
      const res = await fetch("/api/weather", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
      setData(json);
      setError(null);
      // Date.now() is impure, so it can't live in render (e.g. a useMemo) —
      // computing it here, in the fetch's async continuation, keeps render pure.
      const tl: WeatherResponse["cities"][number]["hourly"] = json.cities?.[0]?.hourly ?? [];
      setLiveIndex(tl.length > 0 ? findNearestHourIndex(tl, Date.now()) : -1);
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

  // One combined timeline: monthly deep-history (1940 -> just before the
  // recent window) followed by the hourly window (past 48h -> next 24h).
  // A single index space drives the slider, whichever resolution it lands in.
  const timeline = useMemo(() => data?.cities[0]?.hourly ?? [], [data]);
  const monthlyEntries = useMemo(() => buildMonthlyEntries(timeline[0]?.time), [timeline]);
  const combinedLength = monthlyEntries.length + timeline.length;

  const isLive = scrubIndex === null;
  const liveIndexCombined = liveIndex >= 0 ? monthlyEntries.length + liveIndex : -1;
  const activeIndex = scrubIndex ?? liveIndexCombined;
  const activeZone: "monthly" | "hourly" = activeIndex < monthlyEntries.length ? "monthly" : "hourly";

  // The calendar date the scrubber is currently sitting on (null while live)
  // — this is what both the historical-weather fetch and the historical-quake
  // fetch key off, regardless of which zone/resolution it came from.
  const activeDate: string | null = isLive || activeIndex < 0
    ? null
    : activeZone === "monthly"
      ? monthlyEntries[activeIndex]?.date ?? null
      : timeline[activeIndex - monthlyEntries.length]?.time.slice(0, 10) ?? null;

  const loadQuakes = useCallback(async () => {
    try {
      const url = !isLive && activeDate ? `/api/earthquakes?date=${activeDate}` : "/api/earthquakes";
      const res = await fetch(url, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
      setQuakes(json);
      setQuakesError(null);
    } catch (err) {
      setQuakesError(err instanceof Error ? err.message : String(err));
    }
  }, [isLive, activeDate]);

  useEffect(() => {
    // Debounced: dragging through the timeline shouldn't fire a request per tick.
    const timeout = setTimeout(loadQuakes, isLive ? 0 : 250);
    return () => clearTimeout(timeout);
  }, [loadQuakes, isLive]);

  useEffect(() => {
    if (!isLive) return; // a specific day's quakes are fixed — no need to poll
    const interval = setInterval(loadQuakes, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadQuakes, isLive]);

  const loadHurricanes = useCallback(async () => {
    try {
      const res = await fetch("/api/hurricanes", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
      setHurricanes(json);
      setHurricanesError(null);
    } catch (err) {
      setHurricanesError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadHurricanes();
    const interval = setInterval(loadHurricanes, REFRESH_MS);
    return () => clearInterval(interval);
  }, [loadHurricanes]);

  // Deep-history (monthly zone): fetch a daily-aggregate weather snapshot for
  // every city from Open-Meteo's archive (ERA5, back to 1940), debounced and
  // cached per date so scrubbing back and forth doesn't re-fetch.
  useEffect(() => {
    if (activeZone !== "monthly" || !activeDate) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setHistorySnapshots(null);
      return;
    }

    const cached = historyCacheRef.current.get(activeDate);
    if (cached) {
      setHistorySnapshots(cached);
      setHistoryError(null);
      return;
    }

    let cancelled = false;
    const timeout = setTimeout(() => {
      setHistoryLoading(true);
      setHistoryError(null);

      fetch(`/api/history?date=${activeDate}`, { cache: "no-store" })
        .then(async (res) => {
          const json = await res.json();
          if (!res.ok) throw new Error(json.detail ?? json.error ?? "Unknown error");
          if (!cancelled) {
            historyCacheRef.current.set(activeDate, json.cities);
            setHistorySnapshots(json.cities);
          }
        })
        .catch((err) => {
          if (!cancelled) setHistoryError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          if (!cancelled) setHistoryLoading(false);
        });
    }, 250);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [activeZone, activeDate]);

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

  // What's actually rendered everywhere:
  //  - monthly zone: a frozen daily-aggregate snapshot from decades back
  //  - hourly zone (scrubbed): a frozen hour from the past-48h/next-24h window
  //  - live: current "right now" fields
  // While a new zone/date's data is still in flight, we fall back to the last
  // known-good set (via lastGoodCitiesRef below) instead of an empty array —
  // otherwise the map flashes blank for a beat before the loading blur has
  // anything to blur, which reads as a glitch rather than a loading state.
  const effectiveCities = useMemo<CityWeather[]>(() => {
    if (isLive) return data?.cities ?? lastGoodCities;

    if (activeZone === "monthly") {
      if (!historySnapshots) return lastGoodCities;
      return CITIES.map((city) => {
        const snap = historySnapshots.find((s) => s.id === city.id);
        return {
          id: city.id,
          name: city.name,
          country: city.country,
          lat: city.lat,
          lon: city.lon,
          temperature: snap?.tempMean ?? NaN,
          windSpeed: snap?.windMax ?? NaN,
          precipitation: snap?.precipSum ?? NaN,
          weatherCode: snap?.weatherCode ?? 0,
          isDay: true,
          aqi: NaN,
          pm25: NaN,
          hourly: [],
        };
      });
    }

    if (!data) return lastGoodCities;
    const hourlyIdx = activeIndex - monthlyEntries.length;
    return data.cities.map((city) => {
      const point = city.hourly[hourlyIdx];
      if (!point) return city;
      return {
        ...city,
        temperature: point.temperature,
        windSpeed: point.windSpeed,
        precipitation: point.precipitation,
        weatherCode: point.weatherCode,
        aqi: point.aqi,
        pm25: point.pm25,
        isDay: estimateIsDay(new Date(point.time).getTime(), city.lon),
      };
    });
    // lastGoodCities is intentionally excluded — it's a stale-while-loading
    // fallback only, and reacting to it would create a render loop (each
    // fresh non-fallback result gets mirrored back into lastGoodCities by
    // the effect below).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLive, activeZone, activeIndex, monthlyEntries.length, data, historySnapshots]);

  // Mirrors effectiveCities into state right after each render so the memo
  // above can fall back to "whatever we last had" during a loading gap.
  // effectiveCities only changes identity when its own deps change (not on
  // every render), so this doesn't loop.
  useEffect(() => {
    if (effectiveCities.length > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setLastGoodCities(effectiveCities);
    }
  }, [effectiveCities]);

  // Auto-advance playback through the recent hourly window only — animating
  // through 80 years of monthly history at 350ms/step wouldn't be watchable,
  // so play is disabled while the slider sits in the monthly zone (see the
  // button's `disabled` below).
  useEffect(() => {
    if (!isPlaying || timeline.length === 0) return;
    const interval = setInterval(() => {
      setScrubIndex((current) => {
        const currentHourlyIdx = (current ?? liveIndexCombined) - monthlyEntries.length;
        const next = currentHourlyIdx + 1;
        const wrapped = next >= timeline.length ? 0 : next;
        return monthlyEntries.length + wrapped;
      });
    }, 350);
    return () => clearInterval(interval);
  }, [isPlaying, timeline.length, liveIndexCombined, monthlyEntries.length]);

  function handleScrub(index: number) {
    setIsPlaying(false);
    setScrubIndex(index);
  }

  function jumpToLive() {
    setIsPlaying(false);
    setScrubIndex(null);
  }

  // The date input is a "type to jump" shortcut into the same combined
  // timeline, rather than a separate mode. It's a native <input type="date">
  // so the browser lets people pick any DAY, even though the deep-history
  // side of the timeline only actually samples the 1st of each month — any
  // other day in a covered month still resolves fine via the startsWith
  // check below. The one real gap is the handful of days between the last
  // monthly sample and the start of the recent hourly window (a date in
  // "the current month, but not yet in the last 48h") — without handling
  // that explicitly, picking one of those days silently did nothing, which
  // read as the picker being broken.
  function handleDateInputChange(value: string) {
    if (!value) return;

    const targetMonth = value.slice(0, 7); // YYYY-MM
    const monthlyIdx = monthlyEntries.findIndex((e) => e.date.startsWith(targetMonth));
    if (monthlyIdx >= 0) {
      handleScrub(monthlyIdx);
      return;
    }

    // Exact day within the recent hourly window.
    const hourlyIdx = timeline.findIndex((h) => h.time.slice(0, 10) === value);
    if (hourlyIdx >= 0) {
      handleScrub(monthlyEntries.length + hourlyIdx);
      return;
    }

    // Picked a day that falls in the gap between the two zones — snap to
    // whichever edge is chronologically closer instead of doing nothing.
    const pickedMs = new Date(`${value}T00:00:00Z`).getTime();
    const lastMonthly = monthlyEntries[monthlyEntries.length - 1];
    const firstHourly = timeline[0];
    if (!lastMonthly || !firstHourly) return;

    const lastMonthlyMs = new Date(`${lastMonthly.date}T00:00:00Z`).getTime();
    const firstHourlyMs = new Date(firstHourly.time).getTime();
    if (pickedMs <= lastMonthlyMs) {
      handleScrub(monthlyEntries.length - 1);
    } else if (pickedMs >= firstHourlyMs) {
      handleScrub(monthlyEntries.length);
    } else {
      const distToMonthly = pickedMs - lastMonthlyMs;
      const distToHourly = firstHourlyMs - pickedMs;
      handleScrub(distToMonthly <= distToHourly ? monthlyEntries.length - 1 : monthlyEntries.length);
    }
  }

  const colorScale = useMemo(() => {
    if (effectiveCities.length === 0) return null;
    const values = effectiveCities.map(activeMetric.access).filter((v) => !Number.isNaN(v));
    const min = Math.min(...values, activeMetric.fallbackMin);
    const max = Math.max(...values, activeMetric.fallbackMax);
    const domain = activeMetric.reverse ? [max, min] : [min, max];
    return { scale: scaleSequential(activeMetric.interpolator).domain(domain as [number, number]), min, max };
  }, [effectiveCities, activeMetric]);

  const stats = useMemo(() => {
    const valid = effectiveCities.filter((c) => !Number.isNaN(c.temperature));
    if (valid.length === 0) return null;
    const warmest = valid.reduce((a, b) => (a.temperature > b.temperature ? a : b));
    const coldest = valid.reduce((a, b) => (a.temperature < b.temperature ? a : b));
    const avg = valid.reduce((sum, c) => sum + c.temperature, 0) / valid.length;
    return { warmest, coldest, avg };
  }, [effectiveCities]);

  const searchTerm = search.trim().toLowerCase();
  const matches = useCallback(
    (city: CityWeather) =>
      searchTerm === "" ||
      city.name.toLowerCase().includes(searchTerm) ||
      city.country.toLowerCase().includes(searchTerm),
    [searchTerm]
  );

  const filteredCities = useMemo(
    () => effectiveCities.filter(matches),
    [effectiveCities, matches]
  );

  const selectedCity = useMemo(
    () => (selectedId ? effectiveCities.find((c) => c.id === selectedId) ?? null : null),
    [effectiveCities, selectedId]
  );

  function handleSelect(city: CityWeather) {
    setSelectedId((current) => (current === city.id ? null : city.id));
  }

  function handleMouseMove(e: React.MouseEvent) {
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setMouse({ x: e.clientX - rect.left, y: e.clientY - rect.top });
  }

  const ready = landPath && projection && colorScale && effectiveCities.length > 0;

  const selectedHistorySnapshot = useMemo(
    () =>
      activeZone === "monthly" && !isLive && selectedCity
        ? historySnapshots?.find((s) => s.id === selectedCity.id) ?? null
        : null,
    [activeZone, isLive, historySnapshots, selectedCity]
  );
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
        className={`absolute inset-0 transition-[filter] duration-300 ${view === "map" ? "" : "invisible"} ${
          historyLoading ? "blur-sm" : ""
        }`}
      >
        <svg
          ref={svgRef}
          viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
          // "meet" (not "slice") scales the whole 960x500 world map to fit
          // entirely inside whatever the container's aspect ratio is,
          // letterboxing instead of cropping — so the whole earth is always
          // visible, even on a narrow/tall mobile viewport.
          preserveAspectRatio="xMidYMid meet"
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

              {/* Active storms — live-only (NHC has no free historical-date
                  API like USGS does for quakes), so these only render while
                  following live data, regardless of scrubber position. */}
              {showHurricanes &&
                isLive &&
                hurricanes?.storms.map((storm) => {
                  const coords = projection!([storm.lon, storm.lat]);
                  if (!coords) return null;
                  const [x, y] = coords;
                  const color = hurricaneColor(storm.classification, storm.category);
                  const radius = 6 + (storm.category ?? 0) * 1.6;

                  return (
                    <g
                      key={storm.id}
                      transform={`translate(${x}, ${y})`}
                      onMouseEnter={() => setHoveredHurricane(storm)}
                      onMouseLeave={() => setHoveredHurricane((h) => (h?.id === storm.id ? null : h))}
                      style={{ cursor: "pointer" }}
                    >
                      <g transform={`scale(${1 / mapTransform.k})`}>
                        <circle
                          r={radius * 1.9}
                          fill={color}
                          opacity={0.2}
                          className="orb-pulse"
                          style={{ ["--pulse-duration" as string]: "2.2s" }}
                        />
                        {storm.movementDir !== null && (
                          // Rotated clockwise from north to match meteorological
                          // movementDir convention — the base shape points "up"
                          // (north) at rotate(0).
                          <g transform={`rotate(${storm.movementDir})`}>
                            <line x1={0} y1={-radius - 2} x2={0} y2={-radius - 12} stroke={color} strokeWidth={1.5} />
                            <path d={`M0,${-radius - 14} L-3,${-radius - 9} L3,${-radius - 9} Z`} fill={color} />
                          </g>
                        )}
                        <circle r={radius} fill={color} stroke="#fff" strokeOpacity={0.6} strokeWidth={1} />
                        <Tornado
                          x={-radius * 0.6}
                          y={-radius * 0.6}
                          width={radius * 1.2}
                          height={radius * 1.2}
                          color="#0f172a"
                          strokeWidth={2.5}
                        />
                      </g>
                    </g>
                  );
                })}

              {effectiveCities.map((city) => {
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
                      <weather.icon
                        x={-5}
                        y={-radius - 11}
                        width={10}
                        height={10}
                        color={color}
                        strokeWidth={2.25}
                        opacity={0.9}
                      />
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
            <div className="flex items-center gap-1.5 text-slate-300">
              {(() => {
                const WeatherIcon = describeWeather(hovered.weatherCode).icon;
                return <WeatherIcon size={13} />;
              })()}
              {describeWeather(hovered.weatherCode).label}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-slate-400">
              <span>Temp</span>
              <span className="text-slate-100">{formatTemperature(hovered.temperature, units)}</span>
              <span>Wind</span>
              <span className="text-slate-100">{formatWind(hovered.windSpeed, units)}</span>
              <span>Precip</span>
              <span className="text-slate-100">{formatPrecip(hovered.precipitation, units)}</span>
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
              <span className="text-slate-100">{formatDistance(hoveredQuake.depthKm, units)}</span>
              <span>When</span>
              <span className="text-slate-100">
                {/* "5m ago" only reads right for the live feed — once we're
                    scrubbed into history, "ago" relative to real-world now
                    produces nonsense like "24564d ago", so show the actual
                    date instead. */}
                {isLive ? formatRelativeTime(hoveredQuake.time) : formatAbsoluteDateTime(hoveredQuake.time)}
              </span>
            </div>
          </div>
        )}

        {view === "map" && !hovered && !hoveredQuake && hoveredHurricane && (
          <div
            className="pointer-events-none absolute z-20 max-w-[220px] rounded-lg border border-slate-700 bg-slate-950/95 px-3 py-2 text-xs text-slate-100 shadow-xl backdrop-blur-md"
            style={{ left: mouse.x + 14, top: mouse.y + 14 }}
          >
            <div className="font-semibold">
              {hoveredHurricane.kind} {hoveredHurricane.name}
            </div>
            <div className="text-slate-300">
              {hoveredHurricane.category ? `Category ${hoveredHurricane.category}` : hoveredHurricane.kind}
            </div>
            <div className="mt-1 grid grid-cols-2 gap-x-2 text-slate-400">
              <span>Max wind</span>
              <span className="text-slate-100">{formatWindFromMph(hoveredHurricane.windMph, units)}</span>
              <span>Pressure</span>
              <span className="text-slate-100">
                {hoveredHurricane.pressureMb === null ? "—" : `${hoveredHurricane.pressureMb} mb`}
              </span>
              <span>Movement</span>
              <span className="text-slate-100">
                {hoveredHurricane.movementSpeedMph === null
                  ? "—"
                  : formatWindFromMph(hoveredHurricane.movementSpeedMph, units)}
              </span>
              <span>Updated</span>
              <span className="text-slate-100">{formatRelativeTime(hoveredHurricane.lastUpdate)}</span>
            </div>
          </div>
        )}
      </div>

      {/* Table view: floats above the (hidden) map as a full overlay panel. */}
      {view === "table" && (
        <div
          className={`absolute inset-x-4 bottom-20 top-28 z-30 overflow-y-auto rounded-2xl border border-slate-800 bg-slate-950/95 p-3 backdrop-blur transition-[filter] duration-300 sm:inset-x-8 sm:top-32 ${
            historyLoading ? "blur-sm" : ""
          }`}
        >
          <CityTable cities={filteredCities} selectedId={selectedId} onSelect={handleSelect} units={units} />
        </div>
      )}

      {/* Top overlay bar: title/stats on the left, controls on the right. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 z-40 flex flex-col gap-2 p-4 md:flex-row md:items-start md:justify-between">
        <div className="pointer-events-auto max-w-md rounded-xl border border-slate-800 bg-slate-950/80 px-4 py-3 backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <h1 className="flex items-center gap-2 text-base font-semibold tracking-tight text-slate-100 md:text-lg">
              <Globe size={20} className="shrink-0 text-sky-400" />
              Atmos — check in on earth once in a while
            </h1>
            {/* Controls live behind this button on small screens so the map
                gets real space instead of being squeezed by stacked
                full-width panels — see showControlsPanel below. */}
            <button
              onClick={() => setShowControlsPanel((v) => !v)}
              aria-label={showControlsPanel ? "Hide controls" : "Show controls"}
              aria-expanded={showControlsPanel}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-slate-700 text-slate-200 hover:bg-slate-800 md:hidden"
            >
              {showControlsPanel ? <X size={14} /> : <SlidersHorizontal size={14} />}
            </button>
          </div>
          <div className="mt-1 text-xs text-slate-400">
            {stats ? (
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <Flame size={12} className="text-orange-400" />
                {stats.warmest.name} {formatTemperature(stats.warmest.temperature, units)}
                <span className="text-slate-600">·</span>
                <Snowflake size={12} className="text-sky-400" />
                {stats.coldest.name} {formatTemperature(stats.coldest.temperature, units)}
                <span className="text-slate-600">·</span>
                Avg {formatTemperature(stats.avg, units)}
              </span>
            ) : (
              <span>Loading live weather…</span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-[10px] text-slate-500">
            {data && <span>Updated {formatTimeOnly(data.fetchedAt)}</span>}
            <button
              onClick={loadWeather}
              className="pointer-events-auto flex items-center gap-1 rounded-full border border-slate-600 px-2 py-0.5 text-slate-200 hover:bg-slate-800 transition-colors"
            >
              <RefreshCw size={10} />
              Refresh
            </button>
          </div>
        </div>

        <div
          className={`${showControlsPanel ? "flex" : "hidden"} pointer-events-auto max-w-full flex-wrap items-center gap-2 rounded-xl border border-slate-800 bg-slate-950/80 px-3 py-2 backdrop-blur md:flex`}
        >
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
            onClick={() => setUnits((u) => (u === "metric" ? "imperial" : "metric"))}
            title="Switch units"
            aria-label={`Switch to ${units === "metric" ? "imperial" : "metric"} units`}
            className="flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-300 hover:bg-slate-800 transition-colors"
          >
            <Thermometer size={12} />
            {units === "metric" ? "°C · km/h · mm" : "°F · mph · in"}
          </button>

          <button
            onClick={() => setShowQuakes((v) => !v)}
            title={quakesError ? `Couldn't load earthquakes: ${quakesError}` : undefined}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              showQuakes
                ? "border-amber-600/60 bg-amber-500/20 text-amber-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Activity size={13} />
            Quakes{quakes ? ` (${quakes.quakes.length})` : ""}
          </button>

          <button
            onClick={() => setShowHurricanes((v) => !v)}
            title={
              hurricanesError
                ? `Couldn't load storms: ${hurricanesError}`
                : !isLive
                  ? "Storms are live-only — jump to Now to see them"
                  : undefined
            }
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              showHurricanes
                ? "border-cyan-600/60 bg-cyan-500/20 text-cyan-200"
                : "border-slate-700 text-slate-300 hover:bg-slate-800"
            }`}
          >
            <Tornado size={13} />
            Storms{hurricanes ? ` (${hurricanes.storms.length})` : ""}
          </button>
        </div>
      </div>

      {error && (
        <div className="pointer-events-none absolute left-1/2 top-24 z-40 w-full max-w-md -translate-x-1/2 px-4">
          <div
            className={`pointer-events-auto rounded-md border px-3 py-2 text-center text-sm backdrop-blur ${
              isRateLimited(error)
                ? "border-amber-800 bg-amber-950/90 text-amber-200"
                : "border-red-800 bg-red-950/90 text-red-300"
            }`}
          >
            {isRateLimited(error)
              ? "Rate limited by Open-Meteo — still showing the last data we loaded."
              : `Couldn't reach Open-Meteo: ${error}`}
          </div>
        </div>
      )}

      {view === "map" && (
        <>
          <div className="pointer-events-auto absolute right-3 bottom-20 z-30 flex flex-col gap-1">
            <button
              onClick={() => zoomBy(1.5)}
              aria-label="Zoom in"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
            >
              <ZoomIn size={14} />
            </button>
            <button
              onClick={() => zoomBy(1 / 1.5)}
              aria-label="Zoom out"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
            >
              <ZoomOut size={14} />
            </button>
            <button
              onClick={resetZoom}
              aria-label="Reset zoom"
              className="flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800"
            >
              <RotateCcw size={12} />
            </button>
          </div>

          <div className="pointer-events-none absolute bottom-20 left-3 z-30 flex flex-col gap-2">
            {/* Legend boxes are collapsed behind this button on mobile —
                same reasoning as the top controls panel. */}
            <button
              onClick={() => setShowLegendPanel((v) => !v)}
              aria-label={showLegendPanel ? "Hide legend" : "Show legend"}
              aria-expanded={showLegendPanel}
              className="pointer-events-auto flex h-7 w-7 items-center justify-center rounded-md border border-slate-700 bg-slate-900/90 text-slate-200 hover:bg-slate-800 md:hidden"
            >
              {showLegendPanel ? <X size={14} /> : <Layers size={14} />}
            </button>

            <div className={`${showLegendPanel ? "flex" : "hidden"} flex-col gap-2 md:flex`}>
            {colorScale && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300">
                <div className="mb-1">
                  {activeMetric.label} ({activeMetric.unit(units)})
                </div>
                <div
                  className="h-2 w-32 rounded-full"
                  style={{ background: `linear-gradient(to right, ${legendStops.join(", ")})` }}
                />
                <div className="mt-0.5 flex justify-between">
                  <span>
                    {activeMetric.unitsMetric
                      ? convertMetricValue(activeMetric.unitsMetric, colorScale.min, units).toFixed(0)
                      : colorScale.min.toFixed(0)}
                  </span>
                  <span>
                    {activeMetric.unitsMetric
                      ? convertMetricValue(activeMetric.unitsMetric, colorScale.max, units).toFixed(0)
                      : colorScale.max.toFixed(0)}
                  </span>
                </div>
              </div>
            )}

            {showQuakes && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300">
                <div className="mb-1 flex items-center gap-1.5">
                  <Activity size={11} />
                  M4.5+ earthquakes ({isLive ? "24h" : "this day"})
                </div>
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

            {showHurricanes && isLive && (
              <div className="rounded-lg border border-slate-700 bg-slate-900/90 px-3 py-2 text-[10px] text-slate-300">
                <div className="mb-1 flex items-center gap-1.5">
                  <Tornado size={11} />
                  Active storms (live only)
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: hurricaneColor("TS", null) }}
                    />
                    Storm
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: hurricaneColor("HU", 1) }}
                    />
                    Cat 1-2
                  </span>
                  <span className="flex items-center gap-1">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ background: hurricaneColor("HU", 5) }}
                    />
                    Cat 4-5
                  </span>
                </div>
              </div>
            )}
            </div>
          </div>
        </>
      )}

      {selectedCity && (
        <div
          className={`absolute right-4 top-28 bottom-20 z-40 w-[340px] max-w-[90vw] overflow-y-auto transition-[filter] duration-300 sm:top-32 ${
            historyLoading ? "blur-sm" : ""
          }`}
        >
          <DetailPanel
            city={selectedCity}
            onClose={() => setSelectedId(null)}
            historySnapshot={selectedHistorySnapshot}
            units={units}
          />
        </div>
      )}

      {/* Time-scrubber: one slider spanning 1940 -> now. Monthly resolution
          for deep history, hourly resolution for the recent 48h/next 24h. */}
      {combinedLength > 0 && (
        <div className="pointer-events-auto absolute inset-x-0 bottom-0 z-40 flex flex-wrap items-center gap-2 border-t border-slate-800 bg-slate-950/90 px-3 py-2.5 backdrop-blur sm:gap-3 sm:px-4">
          <button
            onClick={() => setIsPlaying((p) => !p)}
            disabled={activeZone === "monthly"}
            aria-label={isPlaying ? "Pause playback" : "Play through the recent window"}
            title={activeZone === "monthly" ? "Jump into the recent window to play" : undefined}
            className={`order-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-slate-200 ${
              activeZone === "monthly"
                ? "cursor-not-allowed border-slate-800 text-slate-700"
                : "border-slate-700 bg-slate-900/90 hover:bg-slate-800"
            }`}
          >
            {isPlaying ? <Pause size={14} /> : <Play size={14} />}
          </button>

          <div className="order-2 flex min-w-0 flex-1 items-center gap-1.5 truncate text-xs text-slate-300 sm:w-32 sm:flex-none">
            <History size={12} className={`shrink-0 ${isLive ? "text-emerald-400" : "text-amber-400"}`} />
            {isLive ? (
              <span className="font-medium text-emerald-400">Live</span>
            ) : activeZone === "monthly" ? (
              historyLoading ? (
                "Loading…"
              ) : activeDate ? (
                formatMonthYear(activeDate)
              ) : (
                ""
              )
            ) : (
              formatScrubTime(timeline[activeIndex - monthlyEntries.length]?.time ?? "")
            )}
          </div>

          {/* Moved up in DOM order so it naturally lands in the first row on
              mobile (see the flex-wrap + order classes here); sm:order-5
              puts it back at the far right on desktop, matching the
              original single-row layout. */}
          <button
            onClick={jumpToLive}
            disabled={isLive}
            className={`order-3 shrink-0 rounded-full border px-3 py-1 text-xs transition-colors sm:order-5 ${
              isLive
                ? "cursor-default border-slate-800 text-slate-600"
                : "border-slate-600 text-slate-200 hover:bg-slate-800"
            }`}
          >
            Now
          </button>

          <div className="relative order-4 w-full sm:order-3 sm:w-auto sm:flex-1">
            <input
              type="range"
              min={0}
              max={combinedLength - 1}
              step={1}
              value={activeIndex}
              onChange={(e) => handleScrub(Number(e.target.value))}
              className="relative z-10 w-full accent-sky-400"
              aria-label="Scrub through time, 1940 to now"
            />
            {/* Tick marks underneath: decade/5-year ticks across the deep
                monthly history, day/6h ticks across the recent hourly
                window, plus a standalone "now" marker — click any to jump. */}
            <div className="pointer-events-none relative mt-0.5 h-6">
              {monthlyEntries.map((entry, i) => {
                if (i % 60 !== 0) return null; // every 5 years
                const isDecade = i % 240 === 0; // every 20 years
                const pct = (i / (combinedLength - 1)) * 100;
                return (
                  <button
                    key={entry.date}
                    onClick={() => handleScrub(i)}
                    aria-label={`Jump to ${entry.date.slice(0, 4)}`}
                    title={entry.date.slice(0, 4)}
                    style={{ left: `${pct}%` }}
                    className="pointer-events-auto absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 text-slate-600 hover:text-slate-300"
                  >
                    <span className={isDecade ? "h-2 w-[2px] bg-current" : "h-1 w-px bg-current"} />
                    {isDecade && <span className="text-[9px] leading-none">{entry.date.slice(0, 4)}</span>}
                  </button>
                );
              })}

              {timeline.map((point, i) => {
                if (i % 6 !== 0) return null;
                const isDayBoundary = i % 24 === 0;
                const globalIndex = monthlyEntries.length + i;
                const pct = (globalIndex / (combinedLength - 1)) * 100;
                return (
                  <button
                    key={point.time}
                    onClick={() => handleScrub(globalIndex)}
                    aria-label={`Jump to ${formatScrubTime(point.time)}`}
                    title={formatScrubTime(point.time)}
                    style={{ left: `${pct}%` }}
                    className="pointer-events-auto absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 text-slate-600 hover:text-slate-300"
                  >
                    <span className={isDayBoundary ? "h-2 w-[2px] bg-current" : "h-1 w-px bg-current"} />
                    {isDayBoundary && (
                      <span className="text-[9px] leading-none whitespace-nowrap">
                        {formatWeekday(point.time)}
                      </span>
                    )}
                  </button>
                );
              })}

              {liveIndexCombined >= 0 && (
                <button
                  onClick={jumpToLive}
                  aria-label="Jump to now"
                  title="Now"
                  style={{ left: `${(liveIndexCombined / (combinedLength - 1)) * 100}%` }}
                  className="pointer-events-auto absolute top-0 flex -translate-x-1/2 flex-col items-center gap-0.5 text-emerald-500 hover:text-emerald-400"
                >
                  <span className="h-2.5 w-[2px] bg-current" />
                  <span className="text-[9px] leading-none">Now</span>
                </button>
              )}
            </div>
          </div>

          <input
            type="date"
            min="1940-01-01"
            // Previously capped at the last deep-history sample, which
            // meant the browser silently rejected picking any of the last
            // ~3 recent days — the whole "jump to a recent day" path was
            // unreachable. The true latest pickable day is the end of the
            // hourly window (tomorrow), not the last monthly sample.
            max={timeline[timeline.length - 1]?.time.slice(0, 10) ?? monthlyEntries[monthlyEntries.length - 1]?.date}
            value={!isLive ? activeDate ?? "" : ""}
            onChange={(e) => handleDateInputChange(e.target.value)}
            aria-label="Jump to a date"
            className="order-5 w-full rounded-full border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100 [color-scheme:dark] focus:outline-none focus:ring-1 focus:ring-slate-500 sm:order-4 sm:w-auto sm:shrink-0"
          />
        </div>
      )}

      {historyError && activeZone === "monthly" && !isLive && (
        <div className="pointer-events-none absolute inset-x-0 bottom-14 z-40 flex justify-center px-4">
          <div
            className={`pointer-events-auto rounded-md border px-3 py-1.5 text-xs backdrop-blur ${
              isRateLimited(historyError)
                ? "border-amber-800 bg-amber-950/90 text-amber-200"
                : "border-red-800 bg-red-950/90 text-red-300"
            }`}
          >
            {isRateLimited(historyError)
              ? "Rate limited — showing the last date that loaded successfully. Try again shortly."
              : `Couldn't load that date: ${historyError}`}
          </div>
        </div>
      )}
    </div>
  );
}
