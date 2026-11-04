// /admin/* — the back office. Its middleware (requireAdmin) runs before every
// admin loader and action: no valid session → /admin/login; a session without
// admin access → 403. Each action also checks its own capability.
// See app/.server/admin-guard.ts and docs/architecture.md §3.
import type { ReactNode } from "react";
import { Form, isRouteErrorResponse, Link, NavLink, Outlet, useRouteLoaderData } from "react-router";

import { adminUserContext, requireAdmin } from "~/.server/admin-guard";
import type { AdminUser } from "~/.server/session";
import { cx } from "~/components/ui";
import { adminMeta } from "~/lib/admin/meta";
import { can, ROLE_LABEL } from "~/lib/admin/roles";

import type { Route } from "./+types/admin";

export const middleware: Route.MiddlewareFunction[] = [requireAdmin];

export function loader({ context }: Route.LoaderArgs) {
  return { user: context.get(adminUserContext) };
}

export const meta = () => adminMeta("Painel");

export default function AdminLayout({ loaderData }: Route.ComponentProps) {
  return (
    <AdminShell user={loaderData.user}>
      <Outlet />
    </AdminShell>
  );
}

function AdminShell({ user, children }: { user: AdminUser | null; children: ReactNode }) {
  return (
    <div className="min-h-dvh bg-paper">
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Pular para o conteúdo
      </a>
      <header className="border-b border-line bg-surface">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-8 gap-y-3 px-4 py-3 md:px-8">
          <Link to="/admin/orders" className="font-display text-xl">
            Loja Iyanifa <span className="text-base text-muted">· Painel</span>
          </Link>
          <nav aria-label="Painel" className="text-sm">
            <ul className="flex gap-6">
              <li>
                <NavLink
                  to="/admin/orders"
                  className={({ isActive }) => cx("border-b-2 py-1", isActive ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}
                >
                  Pedidos
                </NavLink>
              </li>
              {user && can(user.role, "support.view") && (
                <li>
                  <NavLink
                    to="/admin/support"
                    className={({ isActive }) => cx("border-b-2 py-1", isActive ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}
                  >
                    Atendimento
                  </NavLink>
                </li>
              )}
              {user && can(user.role, "discounts.manage") && (
                <li>
                  <NavLink
                    to="/admin/discounts"
                    className={({ isActive }) => cx("border-b-2 py-1", isActive ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}
                  >
                    Descontos
                  </NavLink>
                </li>
              )}
              {user && can(user.role, "settings.view") && (
                <li>
                  <NavLink
                    to="/admin/settings"
                    className={({ isActive }) => cx("border-b-2 py-1", isActive ? "border-ink font-medium" : "border-transparent text-muted hover:text-ink")}
                  >
                    Configurações
                  </NavLink>
                </li>
              )}
            </ul>
          </nav>
          {user && (
            <div className="ml-auto flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
              <span className="text-muted">
                <span className="text-ink">{user.email}</span> · {ROLE_LABEL[user.role]}
              </span>
              <Form method="post" action="/admin/logout">
                <button type="submit" className="underline-offset-4 hover:underline">
                  Sair
                </button>
              </Form>
            </div>
          )}
        </div>
      </header>
      <main id="conteudo" className="mx-auto max-w-7xl px-4 py-8 md:px-8">
        {children}
      </main>
    </div>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  // Present when a child page failed after the gate let the user in.
  const user = useRouteLoaderData<typeof loader>("admin")?.user ?? null;
  const status = isRouteErrorResponse(error) ? error.status : 500;
  let message = "Ocorreu um erro inesperado no painel. Tente novamente; se continuar, avise o responsável técnico.";
  if (isRouteErrorResponse(error) && typeof error.data === "string" && error.data) message = error.data;
  else if (import.meta.env.DEV && error instanceof Error) message = error.message;
  const title = status === 403 ? "Acesso negado" : status === 404 ? "Não encontrado" : "Erro no painel";

  return (
    <AdminShell user={user}>
      <title>{`${title} | Painel da Loja Iyanifa`}</title>
      <meta name="robots" content="noindex, nofollow" />
      <div className="max-w-xl space-y-4">
        <p className="eyebrow">{status}</p>
        <h1 className="text-3xl">{title}</h1>
        <p className="text-muted">{message}</p>
        <div className="flex flex-wrap items-center gap-4 pt-2">
          {status === 403 && !user && (
            <Form method="post" action="/admin/logout">
              <button type="submit" className="rounded-[var(--radius-control)] bg-accent px-6 py-3 text-sm text-accent-contrast">
                Sair e entrar com outra conta
              </button>
            </Form>
          )}
          {user && (
            <Link to="/admin/orders" className="text-sm underline underline-offset-4">
              Voltar aos pedidos
            </Link>
          )}
        </div>
      </div>
    </AdminShell>
  );
}
