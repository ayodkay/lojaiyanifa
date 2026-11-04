// Merging the browser's wishlist with the account's (wishlists/{uid}). A plain union would bring back a product removed
// on one side since the last sync, so the merge is three-way, against the list both sides had at the last sync:
// kept = in both; plus what either side added since; minus what either side removed since. Order: the browser's
// first (its newest-first order), then the products only the account had.
export function mergeWishlists(local: readonly string[], remote: readonly string[], base: readonly string[] | null): string[] {
  if (base === null) return [...new Set([...local, ...remote])]; // first sync on this browser: nothing was removed yet
  const inBase = new Set(base);
  const inLocal = new Set(local);
  const inRemote = new Set(remote);
  const keep = (id: string) => (inLocal.has(id) && inRemote.has(id)) || (!inBase.has(id) && (inLocal.has(id) || inRemote.has(id)));
  return [...new Set([...local, ...remote])].filter(keep);
}
