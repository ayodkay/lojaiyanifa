// /admin/discounts — coupons and automatic promotions: what each gives, where, when, and how often it was used.
// Rules: app/lib/discounts.ts (one products discount — the best for the customer — plus free shipping).
import { Link } from "react-router";

import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import { listPromotions } from "~/.server/promotions";
import { ButtonLink, cx } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";
import { KIND_LABEL } from "~/lib/admin/promotions";
import type { Promotion } from "~/lib/discounts";
import { formatBRL } from "~/lib/money";

import type { Route } from "./+types/admin.discounts";

export async function loader({ context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "discounts.manage");
  return { promotions: await listPromotions(), now: Date.now() };
}

export const meta = () => adminMeta("Descontos");

function describeValue(p: Promotion): string {
  switch (p.kind) {
    case "percent":
      return `${p.value}%`;
    case "fixed":
      return formatBRL(p.value);
    case "free_shipping":
      return "Frete grátis";
    case "buy_x_get_y":
      return `Leve ${p.buyQuantity + p.getQuantity}, pague ${p.buyQuantity}`;
  }
}

function state(p: Promotion, now: number): { text: string; tone: string } {
  if (!p.active) return { text: "Desativada", tone: "text-muted" };
  if (p.startsAt !== null && now < p.startsAt) return { text: `Começa ${adminDateTime.format(new Date(p.startsAt))}`, tone: "text-muted" };
  if (p.endsAt !== null && now >= p.endsAt) return { text: "Encerrada", tone: "text-muted" };
  if (p.maxRedemptions !== null && p.redemptionCount >= p.maxRedemptions) return { text: "Esgotada", tone: "text-muted" };
  return { text: p.endsAt !== null ? `Ativa até ${adminDateTime.format(new Date(p.endsAt))}` : "Ativa", tone: "text-success" };
}

export default function AdminDiscounts({ loaderData }: Route.ComponentProps) {
  const { promotions, now } = loaderData;
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-3xl md:text-4xl">Descontos</h1>
        <ButtonLink to="/admin/discounts/new">Novo desconto</ButtonLink>
      </div>
      <p className="max-w-3xl text-sm text-muted">
        Cada pedido recebe no máximo um desconto nos produtos — o maior para o cliente, entre o cupom digitado e as promoções automáticas — e, além
        dele, uma promoção de frete grátis.
      </p>
      {promotions.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-8 text-center text-muted">Nenhum cupom ou promoção ainda.</p>
      ) : (
        <ul className="divide-y divide-line border border-line bg-surface">
          {promotions.map((p) => {
            const s = state(p, now);
            return (
              <li key={p.id}>
                <Link to={`/admin/discounts/${encodeURIComponent(p.id)}`} className="grid gap-x-6 gap-y-1 px-4 py-4 hover:bg-paper md:grid-cols-[12rem_minmax(0,1fr)_10rem_12rem] md:items-center">
                  <span className="font-medium">{p.code ? <span className="font-mono">{p.code}</span> : "Automática"}</span>
                  <span className="min-w-0">
                    <span className="block truncate">{p.label}</span>
                    <span className="block truncate text-sm text-muted">
                      {p.name} · {KIND_LABEL[p.kind]}
                    </span>
                  </span>
                  <span className="text-sm">
                    {describeValue(p)}
                    <span className="block text-muted">
                      {p.redemptionCount} uso{p.redemptionCount === 1 ? "" : "s"}
                      {p.maxRedemptions !== null && ` de ${p.maxRedemptions}`}
                    </span>
                  </span>
                  <span className={cx("text-sm", s.tone)}>{s.text}</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
