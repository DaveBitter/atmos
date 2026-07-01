// Metric <-> imperial conversions + display formatting. All raw data from
// the API stays metric (°C, km/h, mm, km) — these helpers only touch
// what's shown to the user, so color scales / math elsewhere are unaffected.

export type UnitSystem = "metric" | "imperial";

export function celsiusToFahrenheit(c: number): number {
  return (c * 9) / 5 + 32;
}

export function kmhToMph(kmh: number): number {
  return kmh * 0.621371;
}

export function mmToInches(mm: number): number {
  return mm / 25.4;
}

export function kmToMiles(km: number): number {
  return km * 0.621371;
}

export function mphToKmh(mph: number): number {
  return mph / 0.621371;
}

export function temperatureUnitLabel(units: UnitSystem): string {
  return units === "metric" ? "°C" : "°F";
}

export function windUnitLabel(units: UnitSystem): string {
  return units === "metric" ? "km/h" : "mph";
}

export function precipUnitLabel(units: UnitSystem): string {
  return units === "metric" ? "mm" : "in";
}

export function distanceUnitLabel(units: UnitSystem): string {
  return units === "metric" ? "km" : "mi";
}

/** e.g. "18.4°C" / "65.1°F", or "—" for NaN. */
export function formatTemperature(celsius: number, units: UnitSystem): string {
  if (Number.isNaN(celsius)) return "—";
  const value = units === "metric" ? celsius : celsiusToFahrenheit(celsius);
  return `${value.toFixed(1)}${temperatureUnitLabel(units)}`;
}

/** e.g. "12 km/h" / "7 mph". */
export function formatWind(kmh: number, units: UnitSystem): string {
  if (Number.isNaN(kmh)) return "—";
  const value = units === "metric" ? kmh : kmhToMph(kmh);
  return `${value.toFixed(0)} ${windUnitLabel(units)}`;
}

/** Same as formatWind, but the source value is already in mph (as NHC reports it). */
export function formatWindFromMph(mph: number | null, units: UnitSystem): string {
  if (mph === null || Number.isNaN(mph)) return "—";
  const value = units === "metric" ? mphToKmh(mph) : mph;
  return `${value.toFixed(0)} ${windUnitLabel(units)}`;
}

/** e.g. "1.2 mm" / "0.05 in". */
export function formatPrecip(mm: number, units: UnitSystem): string {
  if (Number.isNaN(mm)) return "—";
  const value = units === "metric" ? mm : mmToInches(mm);
  return `${value.toFixed(units === "metric" ? 1 : 2)} ${precipUnitLabel(units)}`;
}

/** e.g. "15 km" / "9 mi" — used for earthquake depth. */
export function formatDistance(km: number, units: UnitSystem): string {
  if (Number.isNaN(km)) return "—";
  const value = units === "metric" ? km : kmToMiles(km);
  return `${value.toFixed(0)} ${distanceUnitLabel(units)}`;
}

// Bare numeric conversion (no suffix) for spots that build their own label,
// like a legend's min/max numbers next to a separately-shown unit.
export function convertMetricValue(
  metric: "temperature" | "windSpeed" | "precipitation",
  raw: number,
  units: UnitSystem
): number {
  if (units === "metric") return raw;
  if (metric === "temperature") return celsiusToFahrenheit(raw);
  if (metric === "windSpeed") return kmhToMph(raw);
  return mmToInches(raw);
}
