// POST /logout — ends the customer's sessions on every device (revokes them) and clears this browser's cookie. A GET
// (typed URL, link prefetch) never signs anyone out.
import { redirect } from "react-router";

import { ACCOUNT_HEADERS } from "~/.server/account-guard";
import { endCustomerSession } from "~/.server/customer-session";

import type { Route } from "./+types/logout";

export async function action({ request }: Route.ActionArgs) {
  const setCookie = await endCustomerSession(request);
  return redirect("/", { headers: { ...ACCOUNT_HEADERS, "Set-Cookie": setCookie } });
}

export function loader() {
  return redirect("/account", { headers: ACCOUNT_HEADERS });
}
