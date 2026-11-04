// /orders (the footer's "Meus pedidos") → the order list inside the account; signed-out visitors go on to /login.
import { redirect } from "react-router";

export function loader() {
  return redirect("/account/orders", 301);
}
