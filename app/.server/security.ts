// Request-level security, applied by the root route middleware to every
// document, data and resource response.
import type { MiddlewareFunction } from "react-router";

import { env } from "./env";

/**
 * Content-Security-Policy for production. Script 'unsafe-inline' is needed by
 * React Router's inline hydration scripts on CDN-cached pages (a per-request
 * nonce can't survive shared caching); see docs/security.md for the plan to
 * use nonces on uncached admin/account pages.
 */
const CSP = [
  "default-src 'self'",
  "img-src 'self' data: blob: https://images.prismic.io https://*.cdn.prismic.io https://prismic-io.s3.amazonaws.com",
  "media-src 'self' https://*.cdn.prismic.io https://prismic-io.s3.amazonaws.com",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "connect-src 'self' https://viacep.com.br https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com",
  "frame-src https://www.youtube-nocookie.com https://player.vimeo.com https://challenges.cloudflare.com https://*.firebaseapp.com",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * CSRF defence for every state-changing request: browsers send Sec-Fetch-Site
 * and Origin on cross-site requests, and our session cookie is SameSite=Lax.
 * Webhooks (server-to-server) are exempt and must authenticate themselves.
 */
export function assertSameOrigin(request: Request): void {
  if (SAFE_METHODS.has(request.method)) return;
  const url = new URL(request.url);
  if (url.pathname.startsWith("/api/webhooks/")) return;
  const site = request.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") {
    throw new Response("Cross-site request blocked", { status: 403 });
  }
  const origin = request.headers.get("origin");
  if (origin && origin !== url.origin && origin !== env().SITE_URL) {
    throw new Response("Cross-origin request blocked", { status: 403 });
  }
}

export const securityMiddleware: MiddlewareFunction<Response> = async ({ request }, next) => {
  assertSameOrigin(request);
  const response = await next();
  // Responses from redirect()/static helpers can have immutable headers; copy first.
  const secured = new Response(response.body, response);
  const h = secured.headers;
  h.set("X-Content-Type-Options", "nosniff");
  h.set("Referrer-Policy", "strict-origin-when-cross-origin");
  h.set("X-Frame-Options", "DENY");
  h.set("Permissions-Policy", "camera=(), microphone=(), geolocation=(), payment=(), usb=()");
  h.set("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
  if (import.meta.env.PROD) {
    h.set("Content-Security-Policy", CSP);
    h.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  return secured;
};
