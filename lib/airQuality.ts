// US AQI breakpoints, as used by the EPA and returned by Open-Meteo's
// Air Quality API (us_aqi).
export function describeAqi(aqi: number): { label: string; emoji: string } {
  if (Number.isNaN(aqi)) return { label: "Unknown", emoji: "❔" };
  if (aqi <= 50) return { label: "Good", emoji: "🟢" };
  if (aqi <= 100) return { label: "Moderate", emoji: "🟡" };
  if (aqi <= 150) return { label: "Unhealthy (sensitive)", emoji: "🟠" };
  if (aqi <= 200) return { label: "Unhealthy", emoji: "🔴" };
  if (aqi <= 300) return { label: "Very unhealthy", emoji: "🟣" };
  return { label: "Hazardous", emoji: "🟤" };
}
