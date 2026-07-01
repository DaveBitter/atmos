"use client";

import { useMemo, useState } from "react";
import { ChevronUp, ChevronDown } from "lucide-react";
import type { CityWeather } from "@/app/api/weather/route";
import { describeWeather } from "@/lib/weatherCodes";
import { describeAqi } from "@/lib/airQuality";
import { type UnitSystem, formatTemperature, formatWind, formatPrecip } from "@/lib/units";

type SortKey = "name" | "temperature" | "windSpeed" | "precipitation" | "aqi";

const COLUMNS: { key: SortKey; label: string }[] = [
  { key: "name", label: "City" },
  { key: "temperature", label: "Temp" },
  { key: "windSpeed", label: "Wind" },
  { key: "precipitation", label: "Precip" },
  { key: "aqi", label: "Air quality" },
];

export default function CityTable({
  cities,
  selectedId,
  onSelect,
  units,
}: {
  cities: CityWeather[];
  selectedId: string | null;
  onSelect: (city: CityWeather) => void;
  units: UnitSystem;
}) {
  const [sortKey, setSortKey] = useState<SortKey>("temperature");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("desc");
    }
  }

  const sorted = useMemo(() => {
    const copy = [...cities];
    copy.sort((a, b) => {
      let cmp: number;
      if (sortKey === "name") {
        cmp = a.name.localeCompare(b.name);
      } else {
        const av = Number.isNaN(a[sortKey]) ? -Infinity : a[sortKey];
        const bv = Number.isNaN(b[sortKey]) ? -Infinity : b[sortKey];
        cmp = av - bv;
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    return copy;
  }, [cities, sortKey, sortDir]);

  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-800">
      <table className="w-full min-w-[480px] text-sm">
        <thead>
          <tr className="border-b border-slate-800 bg-slate-900/60 text-left text-slate-400">
            {COLUMNS.map((col) => (
              <th key={col.key} className="px-3 py-2 font-medium">
                <button
                  onClick={() => toggleSort(col.key)}
                  className="flex items-center gap-1 hover:text-slate-100 transition-colors"
                >
                  {col.label}
                  {sortKey === col.key &&
                    (sortDir === "asc" ? (
                      <ChevronUp size={12} className="text-slate-500" />
                    ) : (
                      <ChevronDown size={12} className="text-slate-500" />
                    ))}
                </button>
              </th>
            ))}
            <th className="px-3 py-2 font-medium">Condition</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((city) => {
            const weather = describeWeather(city.weatherCode);
            const isSelected = city.id === selectedId;
            return (
              <tr
                key={city.id}
                onClick={() => onSelect(city)}
                className={`cursor-pointer border-b border-slate-800/60 transition-colors hover:bg-slate-800/50 ${
                  isSelected ? "bg-slate-800/70" : ""
                }`}
              >
                <td className="px-3 py-2 text-slate-100">
                  {city.name} <span className="text-slate-500">{city.country}</span>
                </td>
                <td className="px-3 py-2 text-slate-200">{formatTemperature(city.temperature, units)}</td>
                <td className="px-3 py-2 text-slate-200">{formatWind(city.windSpeed, units)}</td>
                <td className="px-3 py-2 text-slate-200">{formatPrecip(city.precipitation, units)}</td>
                <td className="px-3 py-2 text-slate-200">
                  {Number.isNaN(city.aqi) ? (
                    "—"
                  ) : (
                    <span className="flex items-center gap-1.5">
                      {city.aqi.toFixed(0)}
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{ background: describeAqi(city.aqi).color }}
                      />
                      <span className="text-slate-400">{describeAqi(city.aqi).label}</span>
                    </span>
                  )}
                </td>
                <td className="px-3 py-2 text-slate-200">
                  <span className="flex items-center gap-1.5">
                    <weather.icon size={13} />
                    <span className="text-slate-400">{weather.label}</span>
                  </span>
                </td>
              </tr>
            );
          })}
          {sorted.length === 0 && (
            <tr>
              <td colSpan={6} className="px-3 py-6 text-center text-slate-500">
                No cities match your search.
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
