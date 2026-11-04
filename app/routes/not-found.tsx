// Every path no other route takes (route "*" in app/routes.ts). Without it React Router answered those 404s itself,
// before any route ran: the root middleware never saw them, so the page went out without the security headers (CSP,
// X-Content-Type-Options, X-Frame-Options, HSTS; seen in production, 2026-11-04). Matched here, the request goes
// through the middleware as an unknown product does, and the root ErrorBoundary renders the same 404 page.
// The root loader now runs for these paths too: getContent() keeps the content per Prismic release and re-checks the
// release at most every 10 s.
import { data } from "react-router";

const NOT_FOUND = "Página não encontrada";

export function loader() {
  throw data(NOT_FOUND, { status: 404 });
}

/** Any other method on an unknown path is a 404 too, not a 405. */
export function action() {
  throw data(NOT_FOUND, { status: 404 });
}

/**
 * Never rendered: the loader always throws. Without a component this would be a resource route, and React Router would
 * send the thrown 404 as it is instead of the store's 404 page.
 */
export default function NotFound() {
  return null;
}
