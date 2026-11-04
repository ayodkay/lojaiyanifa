// Which orders belong to a signed-in customer — shared by the account pages (app/.server/customers.ts) and reviews
// ("compra verificada", app/.server/reviews.ts): those placed signed in (`customer.uid`) and — only once the account's
// e-mail is verified — those placed as a guest with the same e-mail. Without verification, anyone could register
// someone else's address and read their orders.
import type { DocumentData } from "firebase-admin/firestore";

import type { CustomerUser } from "./customer-session";

export function ownsOrder(user: CustomerUser, order: DocumentData): boolean {
  if (order.customer?.uid === user.uid) return true;
  return user.emailVerified && typeof order.customer?.email === "string" && order.customer.email.toLowerCase() === user.email;
}
