// The gate in front of every /account page: middleware of the account layout, so it runs before any account loader
// or action (like app/.server/admin-guard.ts). No valid session → /login?redirectTo=…
import { createContext, type MiddlewareFunction, redirect } from "react-router";

import { type CustomerUser, readCustomerSession } from "./customer-session";
import { expiredSessionCookie } from "./session";

/** Set by requireCustomer; reading it anywhere else throws (no default value). */
export const customerContext = createContext<CustomerUser>();

/** Every account response: personal, never cached anywhere, never indexed. */
export const ACCOUNT_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export const requireCustomer: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const session = await readCustomerSession(request);
  if (session.status === "signed_out") {
    const url = new URL(request.url);
    const headers = new Headers(ACCOUNT_HEADERS);
    if (session.staleCookie) headers.append("Set-Cookie", expiredSessionCookie());
    throw redirect(`/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`, { headers });
  }
  context.set(customerContext, session.user);
  const response = await next();
  // Responses from redirect()/static helpers can have immutable headers; copy first.
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(ACCOUNT_HEADERS)) secured.headers.set(name, value);
  return secured;
};
