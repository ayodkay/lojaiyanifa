// Where to send someone after signing in. `redirectTo` arrives in the URL, so
// only paths inside the admin are accepted: the login page can't be used to
// bounce people to another site (open redirect) or back to itself.
export const ADMIN_HOME = "/admin/orders";

const PROBE_ORIGIN = "http://admin.invalid";

export function safeAdminRedirect(value: unknown): string {
  if (typeof value !== "string" || !value.startsWith("/")) return ADMIN_HOME;
  let url: URL;
  try {
    url = new URL(value, PROBE_ORIGIN);
  } catch {
    return ADMIN_HOME;
  }
  // "//evil.com", "/\evil.com", "/\t/evil.com"… all parse to another origin.
  if (url.origin !== PROBE_ORIGIN) return ADMIN_HOME;
  const inAdmin = url.pathname === "/admin" || url.pathname.startsWith("/admin/");
  if (!inAdmin || url.pathname === "/admin/login" || url.pathname === "/admin/logout") return ADMIN_HOME;
  return url.pathname + url.search;
}
