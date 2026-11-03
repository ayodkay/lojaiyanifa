// Liveness probe for uptime monitoring. Never cached.
// Not /healthz: Cloud Run reserves some paths ending in "z". Google's front end answers them with its own 404, so the
// function never sees the request (found in production, 2026-11-03).
export function loader() {
  return Response.json(
    { status: "ok", time: new Date().toISOString() },
    { headers: { "Cache-Control": "no-store" } },
  );
}
