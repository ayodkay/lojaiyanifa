// The account and admin gates (app/.server/account-guard.ts, admin-guard.ts) when a signed-out visitor clicks a link
// to a protected page. A click loads no document: React Router fetches /account/orders.data, and React Router 8 gives
// the middleware that raw request (request.url ends in .data and carries _routes) together with `url`, the page's own
// address. The gates built redirectTo from request.url, so a signed-out click on a link to /account went to
// /login?redirectTo=%2Faccount.data, and after signing in to the .data address (2026-11-06).
import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

vi.mock("~/.server/customer-session", () => ({ readCustomerSession: async () => ({ status: "signed_out", staleCookie: false }) }));
vi.mock("~/.server/session", () => ({
  readAdminSession: async () => ({ status: "signed_out", staleCookie: false }),
  expiredSessionCookie: () => "__session=; Max-Age=0",
}));

const { requireCustomer } = await import("~/.server/account-guard");
const { requireAdmin } = await import("~/.server/admin-guard");

type MiddlewareArgs = Parameters<typeof requireCustomer>[0];

/** What React Router 8 passes middleware when a <Link> to `path` is clicked: a request for its .data URL, and `url`. */
function clickTo(path: string): MiddlewareArgs {
  const url = new URL(path, "http://localhost");
  const dataUrl = new URL(url);
  dataUrl.pathname += ".data";
  dataUrl.searchParams.set("_routes", "root");
  return { request: new Request(dataUrl), url, params: {}, context: new RouterContextProvider(), pattern: "" };
}

/** The Location of the redirect the middleware throws. */
async function redirectTarget(run: () => unknown): Promise<string | null> {
  const thrown = await Promise.resolve()
    .then(run)
    .then(
      () => undefined,
      (error: unknown) => error,
    );
  expect(thrown).toBeInstanceOf(Response);
  return (thrown as Response).headers.get("Location");
}

const next = async () => new Response(null);

describe("a signed-out click on a link to a protected page", () => {
  it("sends a customer to the sign-in with the page's own address", async () => {
    const target = await redirectTarget(() => requireCustomer(clickTo("/account/orders?pagina=2"), next));
    expect(target).toBe(`/login?redirectTo=${encodeURIComponent("/account/orders?pagina=2")}`);
  });

  it("sends the admin to the admin sign-in with the page's own address", async () => {
    const target = await redirectTarget(() => requireAdmin(clickTo("/admin/orders?status=open"), next));
    expect(target).toBe(`/admin/login?redirectTo=${encodeURIComponent("/admin/orders?status=open")}`);
  });
});
