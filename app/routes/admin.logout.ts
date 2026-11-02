// POST /admin/logout — ends the account's sessions on every device (revokes
// them) and clears this browser's cookie. A GET (typed URL, link prefetch)
// never signs anyone out; it just goes back to the admin.
import { redirect } from "react-router";

import { ADMIN_HEADERS } from "~/.server/admin-guard";
import { endAdminSession } from "~/.server/session";

import type { Route } from "./+types/admin.logout";

export async function action({ request }: Route.ActionArgs) {
  const setCookie = await endAdminSession(request);
  return redirect("/admin/login", { headers: { ...ADMIN_HEADERS, "Set-Cookie": setCookie } });
}

export function loader() {
  return redirect("/admin", { headers: ADMIN_HEADERS });
}
