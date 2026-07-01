// Tiny in-memory cache + in-flight request de-duplication for API route
// handlers, on top of Next.js's own fetch Data Cache.
//
// Why both: `fetch(url, { next: { revalidate: false } })` caches the raw
// upstream response indefinitely, but that cache is keyed by request URL
// and may not survive across every deployment target's cold starts. This
// module additionally memoizes the fully-parsed, ready-to-return result
// (so a cache hit skips re-parsing too) for the lifetime of the warm
// server process, and — just as importantly — coalesces concurrent
// requests for the same key into a single upstream call, so a burst of
// simultaneous requests for the same date/params only hits Open-Meteo/USGS
// once instead of N times.
//
// Only successful results are cached; a failed fetch (e.g. a 429) is never
// memoized, so the next request naturally retries against upstream.
const cache = new Map<string, unknown>();
const inFlight = new Map<string, Promise<unknown>>();

export async function cachedFetch<T>(key: string, fetcher: () => Promise<T>): Promise<T> {
  if (cache.has(key)) return cache.get(key) as T;

  const pending = inFlight.get(key);
  if (pending) return pending as Promise<T>;

  const promise = fetcher()
    .then((result) => {
      cache.set(key, result);
      return result;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, promise);
  return promise;
}

// Thrown (or wrapped) when upstream returns 429, so callers/UI can show a
// clearer "rate limited, showing what we have" message instead of a generic
// fetch-failure error.
export class RateLimitError extends Error {
  constructor(source: string) {
    super(`${source} rate-limited this request (429) — showing the last available data instead.`);
    this.name = "RateLimitError";
  }
}
