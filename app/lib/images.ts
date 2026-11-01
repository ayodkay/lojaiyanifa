// Prismic serves images through imgix, so resizing/format negotiation is a
// matter of URL parameters (auto=format,compress picks AVIF/WebP when supported).
export function imgixSrc(url: string, params: Record<string, string | number>): string {
  const u = new URL(url);
  u.searchParams.set("auto", "format,compress");
  for (const [key, value] of Object.entries(params)) u.searchParams.set(key, String(value));
  return u.toString();
}

export function imgixSrcSet(url: string, widths: number[], params: Record<string, string | number> = {}): string {
  return widths.map((w) => `${imgixSrc(url, { ...params, w })} ${w}w`).join(", ");
}
