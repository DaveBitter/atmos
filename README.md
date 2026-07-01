# Atmos 🌍

A live, playful weather visualization of ~30 cities around the world, full-bleed
across the screen. Each city is an orb on a D3-rendered world map, and the color
it's shaded by is switchable:

- **Temperature / wind speed / precipitation / air quality** — pick which one
  drives orb color via the metric selector; a legend shows the active scale.
- **Size & pulse speed** = wind speed (independent of the color-by metric).
- **Falling droplets** = it's raining there right now.
- **Dim ring / blue outline** = it's currently night in that city.
- **Amber/red ripples** = a magnitude 4.5+ earthquake somewhere in the last 24h
  (a second, independent live layer — toggle with the 🌎 Quakes button).

Click any orb (or a row in the table view) to pin a detail panel with a 24-hour
forecast sparkline. Search filters both the map and the table. The map supports
pan/zoom (orbs stay a constant screen size regardless of zoom level).

Data comes straight from free, no-API-key-required APIs — [Open-Meteo](https://open-meteo.com)
(weather + air quality) and [USGS](https://earthquake.usgs.gov) (earthquakes) —
fetched server-side and cached for 5 minutes. The map itself is Natural Earth land
data via `world-atlas`.

## Stack

Next.js (App Router) · TypeScript · Tailwind CSS · D3 (`d3-geo`, `d3-scale`,
`d3-scale-chromatic`, `d3-zoom`, `d3-selection`, `d3-array`) · `topojson-client`

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## How it's wired

- `lib/cities.ts` — the curated list of cities (lat/lon), chosen for spread across
  continents rather than any ranking. Add/remove cities here.
- `app/api/weather/route.ts` — server route that batches all cities into a single
  Open-Meteo request (current weather + air quality) and normalizes the response.
- `app/api/forecast/[id]/route.ts` — hourly forecast for one city, used by the
  detail panel's sparkline.
- `app/api/earthquakes/route.ts` — proxies USGS's magnitude 4.5+, past-day feed.
- `lib/weatherCodes.ts` / `lib/airQuality.ts` — map WMO weather codes and US AQI
  values to emoji/labels.
- `components/WeatherGlobe.tsx` — the client component: loads the land topology,
  projects coordinates with `d3-geo`, wires up `d3-zoom` for pan/zoom, and renders
  everything as plain SVG/JSX (D3 is used only for math — projection, path
  generation, color scales — not DOM manipulation, so it plays nicely with React).
- `components/DetailPanel.tsx` — per-city drawer with stats + forecast sparkline.
- `components/CityTable.tsx` — sortable/searchable table view, synced with the map.
- `public/land-110m.json` — low-res world land topology, copied from `world-atlas`.

## Ideas for extending it

- Swap the city list for live geolocation of visitors, or let people pin their own city.
- Add a time-lapse slider using Open-Meteo's historical/forecast endpoints.
- Layer in UV index or marine/wave data (also free on Open-Meteo).
- Deploy to Vercel or Netlify — it's a standard Next.js app, no env vars needed.

## Deploy

Standard Next.js deploy — works as-is on Vercel or Netlify, no environment
variables or API keys required.
