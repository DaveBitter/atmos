import {
  Sun,
  CloudSun,
  Cloud,
  CloudFog,
  CloudDrizzle,
  CloudRain,
  CloudSnow,
  CloudLightning,
  HelpCircle,
  type LucideIcon,
} from "lucide-react";

// WMO weather interpretation codes, as used by Open-Meteo.
// https://open-meteo.com/en/docs (see "WMO Weather interpretation codes")
export const WEATHER_CODES: Record<number, { label: string; icon: LucideIcon }> = {
  0: { label: "Clear sky", icon: Sun },
  1: { label: "Mainly clear", icon: CloudSun },
  2: { label: "Partly cloudy", icon: CloudSun },
  3: { label: "Overcast", icon: Cloud },
  45: { label: "Fog", icon: CloudFog },
  48: { label: "Depositing rime fog", icon: CloudFog },
  51: { label: "Light drizzle", icon: CloudDrizzle },
  53: { label: "Drizzle", icon: CloudDrizzle },
  55: { label: "Dense drizzle", icon: CloudRain },
  56: { label: "Freezing drizzle", icon: CloudRain },
  57: { label: "Dense freezing drizzle", icon: CloudRain },
  61: { label: "Slight rain", icon: CloudRain },
  63: { label: "Rain", icon: CloudRain },
  65: { label: "Heavy rain", icon: CloudRain },
  66: { label: "Freezing rain", icon: CloudRain },
  67: { label: "Heavy freezing rain", icon: CloudRain },
  71: { label: "Slight snow", icon: CloudSnow },
  73: { label: "Snow", icon: CloudSnow },
  75: { label: "Heavy snow", icon: CloudSnow },
  77: { label: "Snow grains", icon: CloudSnow },
  80: { label: "Slight showers", icon: CloudDrizzle },
  81: { label: "Showers", icon: CloudRain },
  82: { label: "Violent showers", icon: CloudLightning },
  85: { label: "Slight snow showers", icon: CloudSnow },
  86: { label: "Heavy snow showers", icon: CloudSnow },
  95: { label: "Thunderstorm", icon: CloudLightning },
  96: { label: "Thunderstorm, slight hail", icon: CloudLightning },
  99: { label: "Thunderstorm, heavy hail", icon: CloudLightning },
};

export function describeWeather(code: number) {
  return WEATHER_CODES[code] ?? { label: "Unknown", icon: HelpCircle };
}
