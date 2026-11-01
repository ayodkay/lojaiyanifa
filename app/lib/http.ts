// Cache policies (see docs/architecture.md §2). Leaf routes must export one of
// these as `headers`, because React Router sends the deepest route's headers.

/** Same HTML for every visitor: short at Firebase's CDN, long at Cloudflare (purged on publish). */
export const PUBLIC_CACHE: HeadersInit = {
  "Cache-Control": "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
  "Cloudflare-CDN-Cache-Control": "max-age=86400",
};

/** Personal or transactional responses: never stored by any cache. */
export const NO_STORE: HeadersInit = {
  "Cache-Control": "private, no-store",
};

export const publicCache = () => PUBLIC_CACHE;
export const noStore = () => NO_STORE;

/** Public cache, but never longer than `maxSeconds` (e.g. until a scheduled banner ends). */
export function publicCacheUntil(maxSeconds: number | null): HeadersInit {
  if (maxSeconds === null) return PUBLIC_CACHE;
  const s = Math.max(0, Math.floor(maxSeconds));
  return {
    "Cache-Control": `public, max-age=0, s-maxage=${Math.min(60, s)}, stale-while-revalidate=${Math.min(300, s)}`,
    "Cloudflare-CDN-Cache-Control": `max-age=${Math.min(86400, s)}`,
  };
}
