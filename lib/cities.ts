export type City = {
  id: string;
  name: string;
  country: string;
  lat: number;
  lon: number;
};

// A spread of cities across every inhabited continent + a couple of extremes,
// chosen for good coverage on a world map rather than any particular ranking.
export const CITIES: City[] = [
  { id: "ams", name: "Amsterdam", country: "NL", lat: 52.37, lon: 4.9 },
  { id: "lon", name: "London", country: "UK", lat: 51.51, lon: -0.13 },
  { id: "par", name: "Paris", country: "FR", lat: 48.85, lon: 2.35 },
  { id: "ber", name: "Berlin", country: "DE", lat: 52.52, lon: 13.4 },
  { id: "rey", name: "Reykjavik", country: "IS", lat: 64.15, lon: -21.94 },
  { id: "mos", name: "Moscow", country: "RU", lat: 55.75, lon: 37.62 },
  { id: "ist", name: "Istanbul", country: "TR", lat: 41.01, lon: 28.98 },
  { id: "cai", name: "Cairo", country: "EG", lat: 30.04, lon: 31.24 },
  { id: "lag", name: "Lagos", country: "NG", lat: 6.52, lon: 3.38 },
  { id: "nai", name: "Nairobi", country: "KE", lat: -1.29, lon: 36.82 },
  { id: "cpt", name: "Cape Town", country: "ZA", lat: -33.92, lon: 18.42 },
  { id: "dxb", name: "Dubai", country: "AE", lat: 25.2, lon: 55.27 },
  { id: "del", name: "Delhi", country: "IN", lat: 28.61, lon: 77.21 },
  { id: "bkk", name: "Bangkok", country: "TH", lat: 13.75, lon: 100.5 },
  { id: "sin", name: "Singapore", country: "SG", lat: 1.35, lon: 103.82 },
  { id: "hkg", name: "Hong Kong", country: "HK", lat: 22.32, lon: 114.17 },
  { id: "bei", name: "Beijing", country: "CN", lat: 39.9, lon: 116.4 },
  { id: "tok", name: "Tokyo", country: "JP", lat: 35.68, lon: 139.65 },
  { id: "seo", name: "Seoul", country: "KR", lat: 37.57, lon: 126.98 },
  { id: "syd", name: "Sydney", country: "AU", lat: -33.87, lon: 151.21 },
  { id: "akl", name: "Auckland", country: "NZ", lat: -36.85, lon: 174.76 },
  { id: "hnl", name: "Honolulu", country: "US", lat: 21.31, lon: -157.86 },
  { id: "anc", name: "Anchorage", country: "US", lat: 61.22, lon: -149.9 },
  { id: "lax", name: "Los Angeles", country: "US", lat: 34.05, lon: -118.24 },
  { id: "nyc", name: "New York", country: "US", lat: 40.71, lon: -74.01 },
  { id: "mex", name: "Mexico City", country: "MX", lat: 19.43, lon: -99.13 },
  { id: "bog", name: "Bogotá", country: "CO", lat: 4.71, lon: -74.07 },
  { id: "lim", name: "Lima", country: "PE", lat: -12.05, lon: -77.04 },
  { id: "rio", name: "Rio de Janeiro", country: "BR", lat: -22.91, lon: -43.17 },
  { id: "bue", name: "Buenos Aires", country: "AR", lat: -34.6, lon: -58.38 },
  { id: "ush", name: "Ushuaia", country: "AR", lat: -54.8, lon: -68.3 },
  { id: "yto", name: "Toronto", country: "CA", lat: 43.65, lon: -79.38 },
];
