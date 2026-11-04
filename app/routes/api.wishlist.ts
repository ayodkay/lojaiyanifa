// /api/wishlist — the signed-in customer's saved wishlist. GET → { productIds }; PUT { productIds } replaces it (the
// /wishlist page merges first: app/lib/wishlist-sync.ts). Without a session: 401 (guests keep theirs in the browser).
// PUT passes the root middleware's same-origin check like every non-GET request.
import { data } from "react-router";

import { readCustomerSession } from "~/.server/customer-session";
import { getWishlist, setWishlist } from "~/.server/customers";
import { NO_STORE } from "~/lib/http";

import type { Route } from "./+types/api.wishlist";

async function signedIn(request: Request) {
  const session = await readCustomerSession(request);
  return session.status === "ok" ? session.user : null;
}

export async function loader({ request }: Route.LoaderArgs) {
  const user = await signedIn(request);
  if (!user) return data({ productIds: null }, { status: 401, headers: NO_STORE });
  return data({ productIds: await getWishlist(user.uid) }, { headers: NO_STORE });
}

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "PUT") return data({ error: "method not allowed" }, { status: 405, headers: { ...NO_STORE, Allow: "GET, PUT" } });
  const user = await signedIn(request);
  if (!user) return data({ productIds: null }, { status: 401, headers: NO_STORE });
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return data({ error: "invalid JSON" }, { status: 400, headers: NO_STORE });
  }
  const ids = (body as { productIds?: unknown } | null)?.productIds;
  if (!Array.isArray(ids)) return data({ error: "productIds must be an array" }, { status: 400, headers: NO_STORE });
  return data({ productIds: await setWishlist(user.uid, ids) }, { headers: NO_STORE });
}
