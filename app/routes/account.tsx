// /account/* — "Minha conta". Its middleware (requireCustomer) runs before every account loader and action: no valid
// session → /login?redirectTo=… See app/.server/account-guard.ts and docs/architecture.md §3.
import { Form, NavLink, Outlet } from "react-router";

import { ACCOUNT_HEADERS, customerContext, requireCustomer } from "~/.server/account-guard";
import { getCustomerProfile } from "~/.server/customers";
import { Breadcrumbs, cx } from "~/components/ui";
import { firstName } from "~/lib/account";

import type { Route } from "./+types/account";

export const middleware: Route.MiddlewareFunction[] = [requireCustomer];

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(customerContext);
  const profile = await getCustomerProfile(user.uid);
  return { email: user.email, emailVerified: user.emailVerified, firstName: firstName(profile?.name), hasProfile: profile !== null };
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = () => [{ title: "Minha conta | Loja Iyanifa" }, { name: "robots", content: "noindex, nofollow" }];

const LINKS = [
  { to: "/account", label: "Visão geral", end: true },
  { to: "/account/orders", label: "Pedidos" },
  { to: "/account/profile", label: "Dados pessoais" },
  { to: "/account/addresses", label: "Endereços" },
  { to: "/account/security", label: "Senha e acesso" },
  { to: "/account/privacy", label: "Privacidade e dados" },
];

export default function AccountLayout({ loaderData }: Route.ComponentProps) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Minha conta", href: "/account" }]} />
      <div className="mt-8 grid gap-10 md:grid-cols-[14rem_1fr]">
        <aside>
          <p className="font-display text-2xl">{loaderData.firstName ? `Olá, ${loaderData.firstName}` : "Minha conta"}</p>
          <p className="mt-1 break-all text-sm text-muted">{loaderData.email}</p>
          <nav aria-label="Minha conta" className="mt-6">
            <ul className="space-y-1 text-sm">
              {LINKS.map((link) => (
                <li key={link.to}>
                  <NavLink
                    to={link.to}
                    end={link.end}
                    className={({ isActive }) => cx("block rounded px-3 py-2", isActive ? "bg-surface font-medium text-ink" : "text-ink-soft hover:bg-surface hover:text-ink")}
                  >
                    {link.label}
                  </NavLink>
                </li>
              ))}
            </ul>
          </nav>
          <Form method="post" action="/logout" className="mt-6">
            <button type="submit" className="px-3 text-sm text-muted underline underline-offset-4 hover:text-ink">
              Sair (em todos os aparelhos)
            </button>
          </Form>
        </aside>
        <div className="min-w-0">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
