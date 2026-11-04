// GET /account/export — the customer's data as a JSON file (LGPD art. 18, II and V). Behind the account gate like every
// /account path; recorded in the audit log (app/.server/customers.ts, exportCustomerData).
import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { exportCustomerData } from "~/.server/customers";

import type { Route } from "./+types/account.export";

export async function loader({ context }: Route.LoaderArgs) {
  const now = new Date();
  const body = JSON.stringify(await exportCustomerData(context.get(customerContext), now), null, 2);
  return new Response(body, {
    headers: {
      ...ACCOUNT_HEADERS,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="meus-dados-loja-iyanifa-${now.toISOString().slice(0, 10)}.json"`,
    },
  });
}
