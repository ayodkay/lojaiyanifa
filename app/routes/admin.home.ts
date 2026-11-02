// /admin — the orders list is the admin's home for now (the dashboard comes later).
// The layout's middleware has already checked the session when this runs.
import { redirect } from "react-router";

import { ADMIN_HEADERS } from "~/.server/admin-guard";
import { ADMIN_HOME } from "~/lib/admin/redirect";

export function loader() {
  return redirect(ADMIN_HOME, { headers: ADMIN_HEADERS });
}
