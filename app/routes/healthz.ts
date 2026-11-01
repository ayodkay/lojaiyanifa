// Liveness probe for uptime monitoring. Never cached.
export function loader() {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
