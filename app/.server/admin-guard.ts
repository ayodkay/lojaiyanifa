// The gate in front of every /admin page. It runs as middleware of the admin
// layout, which React Router runs BEFORE any of the layout's or its children's
// loaders and actions (a layout loader would not do: loaders run in parallel,
// so a child could read data while the parent redirects). Actions then check
// the specific capability with requireCapability().
import { createContext, data, type MiddlewareFunction, redirect } from "react-router";

import { type Capability, can } from "~/lib/admin/roles";

import { type AdminRefusal, type AdminUser, expiredSessionCookie, readAdminSession } from "./session";

/** Set by requireAdmin; reading it anywhere else throws (no default value). */
export const adminUserContext = createContext<AdminUser>();

/** Every admin response: never cached anywhere, never indexed. */
export const ADMIN_HEADERS = { "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex, nofollow" };

export const REFUSAL_MESSAGE: Record<AdminRefusal, string> = {
  not_admin: "Esta conta não tem acesso ao painel.",
  email_unverified: "Confirme o seu e-mail antes de usar o painel.",
  mfa_required: "O painel exige verificação em duas etapas, que ainda não está disponível nesta versão.",
};

export const requireAdmin: MiddlewareFunction<Response> = async ({ request, context }, next) => {
  const session = await readAdminSession(request);
  if (session.status === "signed_out") {
    const url = new URL(request.url);
    const headers = new Headers(ADMIN_HEADERS);
    if (session.staleCookie) headers.append("Set-Cookie", expiredSessionCookie());
    throw redirect(`/admin/login?redirectTo=${encodeURIComponent(url.pathname + url.search)}`, { headers });
  }
  if (session.status === "forbidden") {
    throw data(REFUSAL_MESSAGE[session.reason], { status: 403, headers: ADMIN_HEADERS });
  }
  context.set(adminUserContext, session.user);

  const response = await next();
  // Responses from redirect()/static helpers can have immutable headers; copy first.
  const secured = new Response(response.body, response);
  for (const [name, value] of Object.entries(ADMIN_HEADERS)) secured.headers.set(name, value);
  return secured;
};

/** Throws 403 unless the signed-in admin's role allows `capability`. */
export function requireCapability(user: AdminUser, capability: Capability): void {
  if (!can(user.role, capability)) {
    throw data("A sua função não permite esta ação.", { status: 403, headers: ADMIN_HEADERS });
  }
}
