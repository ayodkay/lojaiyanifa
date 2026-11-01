// Some browsers request /favicon.ico regardless of <link rel="icon">; point them at the SVG.
export function loader() {
  return new Response(null, {
    status: 301,
    headers: { Location: "/favicon.svg", "Cache-Control": "public, max-age=86400" },
  });
}
