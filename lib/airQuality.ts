// US AQI breakpoints, as used by the EPA and returned by Open-Meteo's
// Air Quality API (us_aqi). Returns a label + swatch color rather than an
// icon — a color-coded dot reads faster for a severity scale than iconography.
export function describeAqi(aqi: number): { label: string; color: string } {
  if (Number.isNaN(aqi)) return { label: "Unknown", color: "#64748b" };
  if (aqi <= 50) return { label: "Good", color: "#4ade80" };
  if (aqi <= 100) return { label: "Moderate", color: "#facc15" };
  if (aqi <= 150) return { label: "Unhealthy (sensitive)", color: "#f97316" };
  if (aqi <= 200) return { label: "Unhealthy", color: "#ef4444" };
  if (aqi <= 300) return { label: "Very unhealthy", color: "#a855f7" };
  return { label: "Hazardous", color: "#7f1d1d" };
}
