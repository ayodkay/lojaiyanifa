// /admin/discounts/new and /admin/discounts/:id — create or edit a coupon or an automatic promotion. A coupon's code is
// its identity and can't change after creation; the use count is only changed by orders (app/.server/promotions.ts).
import { useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { ADMIN_HEADERS, adminUserContext, requireCapability } from "~/.server/admin-guard";
import { getContent } from "~/.server/prismic";
import { getPromotion, PromotionCodeTakenError, savePromotion } from "~/.server/promotions";
import { Button, cx, Notice } from "~/components/ui";
import { adminMeta } from "~/lib/admin/meta";
import { KIND_LABEL, parsePromotionForm, toBrasiliaInput } from "~/lib/admin/promotions";
import { PROMOTION_KINDS, type PromotionKind } from "~/lib/discounts";
import { toDecimalString } from "~/lib/money";

import type { Route } from "./+types/admin.discount";

export async function loader({ params, context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "discounts.manage");
  const id = params.id ?? null;
  const promotion = id ? await getPromotion(id) : null;
  if (id && !promotion) throw data("Desconto não encontrado.", { status: 404, headers: ADMIN_HEADERS });
  const { catalog } = await getContent();
  return {
    promotion,
    products: catalog.products.map((p) => ({ id: p.id, name: p.name })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR")),
    categories: catalog.categories.filter((c) => !c.showAll).map((c) => ({ id: c.id, name: c.title })),
  };
}

export async function action({ request, params, context }: Route.ActionArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "discounts.manage");
  const id = params.id ?? null;
  const existing = id ? await getPromotion(id) : null;
  if (id && !existing) throw data("Desconto não encontrado.", { status: 404, headers: ADMIN_HEADERS });
  const parsed = parsePromotionForm(await request.formData(), existing ? existing.code : undefined);
  if (!parsed.ok) return data({ errors: parsed.errors }, { status: 400, headers: ADMIN_HEADERS });
  try {
    await savePromotion(id, parsed.value, user);
  } catch (error) {
    if (error instanceof PromotionCodeTakenError) return data({ errors: { code: "Já existe um cupom com este código." } }, { status: 409, headers: ADMIN_HEADERS });
    throw error;
  }
  return redirect("/admin/discounts", { headers: ADMIN_HEADERS });
}

export const meta = ({ params }: Route.MetaArgs) => adminMeta(params.id ? "Editar desconto" : "Novo desconto");

const INPUT = "min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3";

function Err({ id, text }: { id: string; text?: string }) {
  return text ? (
    <p id={`${id}-erro`} className="mt-1 text-sm text-danger">
      {text}
    </p>
  ) : null;
}

export default function AdminDiscount({ loaderData, actionData }: Route.ComponentProps) {
  const { promotion: p, products, categories } = loaderData;
  const errors: Record<string, string> = actionData?.errors ?? {};
  const navigation = useNavigation();
  const [type, setType] = useState<"coupon" | "automatic">(p ? (p.code ? "coupon" : "automatic") : "coupon");
  const [kind, setKind] = useState<PromotionKind>(p?.kind ?? "percent");
  const [scope, setScope] = useState(p?.scope.type ?? "all");
  const selectedProducts = p?.scope.type === "products" ? p.scope.productIds : [];
  const selectedCategories = p?.scope.type === "categories" ? p.scope.categoryIds : [];

  return (
    <div className="max-w-3xl space-y-6">
      <Link to="/admin/discounts" className="text-sm underline underline-offset-4">
        ← Descontos
      </Link>
      <h1 className="text-3xl md:text-4xl">{p ? (p.code ? `Cupom ${p.code}` : "Promoção automática") : "Novo desconto"}</h1>
      {p && (
        <p className="text-sm text-muted">
          Usado {p.redemptionCount} vez{p.redemptionCount === 1 ? "" : "es"} (pedidos não pagos e cancelados devolvem o uso).
        </p>
      )}
      {Object.keys(errors).length > 0 && <Notice tone="danger">Confira os campos marcados.</Notice>}

      <Form method="post" noValidate className="space-y-8">
        <fieldset className="space-y-3">
          <legend className="mb-2 text-lg">Tipo</legend>
          {p ? (
            <p className="text-sm">{p.code ? "Cupom (o cliente digita o código)" : "Automática (vale sem código)"} — não muda depois de criado.</p>
          ) : (
            <>
              <label className="flex gap-3 text-sm">
                <input type="radio" name="type" value="coupon" checked={type === "coupon"} onChange={() => setType("coupon")} />
                Cupom: o cliente digita um código no carrinho
              </label>
              <label className="flex gap-3 text-sm">
                <input type="radio" name="type" value="automatic" checked={type === "automatic"} onChange={() => setType("automatic")} />
                Automática: vale para todos que atendem às condições
              </label>
              {type === "coupon" && (
                <div>
                  <label htmlFor="f-code" className="mb-1 block text-sm">
                    Código
                  </label>
                  <input id="f-code" name="code" className={cx(INPUT, "font-mono uppercase sm:max-w-xs")} aria-invalid={errors.code ? true : undefined} />
                  <Err id="f-code" text={errors.code} />
                </div>
              )}
            </>
          )}
        </fieldset>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="f-name" className="mb-1 block text-sm">
              Nome interno
            </label>
            <input id="f-name" name="name" defaultValue={p?.name} className={INPUT} aria-invalid={errors.name ? true : undefined} />
            <Err id="f-name" text={errors.name} />
          </div>
          <div>
            <label htmlFor="f-label" className="mb-1 block text-sm">
              Texto para o cliente
            </label>
            <input id="f-label" name="label" defaultValue={p?.label} placeholder="Ex.: 10% na primeira compra" className={INPUT} aria-invalid={errors.label ? true : undefined} />
            <Err id="f-label" text={errors.label} />
          </div>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-lg">Desconto</legend>
          <select name="kind" value={kind} onChange={(e) => setKind(e.target.value as PromotionKind)} className={cx(INPUT, "sm:max-w-sm")} aria-label="Tipo de desconto">
            {PROMOTION_KINDS.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
          {kind === "percent" && (
            <div className="sm:max-w-xs">
              <label htmlFor="f-percent" className="mb-1 block text-sm">
                Porcentagem (1 a 99)
              </label>
              <input id="f-percent" name="percent" type="number" min={1} max={99} defaultValue={p?.kind === "percent" ? p.value : 10} className={INPUT} />
              <Err id="f-percent" text={errors.percent} />
            </div>
          )}
          {kind === "fixed" && (
            <div className="sm:max-w-xs">
              <label htmlFor="f-amount" className="mb-1 block text-sm">
                Valor (R$)
              </label>
              <input id="f-amount" name="amount" type="number" min="0.01" step="0.01" defaultValue={p?.kind === "fixed" ? toDecimalString(p.value) : ""} className={INPUT} />
              <Err id="f-amount" text={errors.amount} />
            </div>
          )}
          {kind === "buy_x_get_y" && (
            <div className="grid gap-4 sm:max-w-md sm:grid-cols-2">
              <div>
                <label htmlFor="f-buy" className="mb-1 block text-sm">
                  Compra (unidades)
                </label>
                <input id="f-buy" name="buyQuantity" type="number" min={1} max={20} defaultValue={p?.buyQuantity || 2} className={INPUT} />
                <Err id="f-buy" text={errors.buyQuantity} />
              </div>
              <div>
                <label htmlFor="f-get" className="mb-1 block text-sm">
                  Ganha (as mais baratas)
                </label>
                <input id="f-get" name="getQuantity" type="number" min={1} max={20} defaultValue={p?.getQuantity || 1} className={INPUT} />
                <Err id="f-get" text={errors.getQuantity} />
              </div>
            </div>
          )}
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-lg">Onde vale</legend>
          {(["all", "products", "categories"] as const).map((s) => (
            <label key={s} className="flex gap-3 text-sm">
              <input type="radio" name="scope" value={s} checked={scope === s} onChange={() => setScope(s)} />
              {s === "all" ? "Na loja toda" : s === "products" ? "Em produtos escolhidos" : "Em categorias escolhidas"}
            </label>
          ))}
          {scope === "products" && (
            <div className="space-y-2 border border-line p-3">
              <div className="grid max-h-64 gap-1 overflow-y-auto text-sm sm:grid-cols-2">
                {products.map((prod) => (
                  <label key={prod.id} className="flex gap-2">
                    <input type="checkbox" name="productIds" value={prod.id} defaultChecked={selectedProducts.includes(prod.id)} />
                    {prod.name}
                  </label>
                ))}
              </div>
              <Err id="f-products" text={errors.productIds} />
              <label className="flex gap-2 text-sm">
                <input type="checkbox" name="requireAll" defaultChecked={p?.scope.type === "products" && p.scope.requireAll} />
                Kit: só vale se todos os produtos escolhidos estiverem no carrinho
              </label>
            </div>
          )}
          {scope === "categories" && (
            <div className="border border-line p-3 text-sm">
              {categories.length === 0 ? (
                <p className="text-muted">Nenhuma categoria publicada no Prismic ainda.</p>
              ) : (
                <div className="grid gap-1 sm:grid-cols-2">
                  {categories.map((c) => (
                    <label key={c.id} className="flex gap-2">
                      <input type="checkbox" name="categoryIds" value={c.id} defaultChecked={selectedCategories.includes(c.id)} />
                      {c.name}
                    </label>
                  ))}
                </div>
              )}
              <Err id="f-categories" text={errors.categoryIds} />
            </div>
          )}
        </fieldset>

        <fieldset className="grid gap-4 sm:grid-cols-2">
          <legend className="mb-2 text-lg">Condições</legend>
          <div>
            <label htmlFor="f-min" className="mb-1 block text-sm">
              Pedido mínimo (R$, opcional)
            </label>
            <input id="f-min" name="minSubtotal" type="number" min="0" step="0.01" defaultValue={p?.minSubtotalCents ? toDecimalString(p.minSubtotalCents) : ""} className={INPUT} />
            <Err id="f-min" text={errors.minSubtotal} />
          </div>
          <div />
          <div>
            <label htmlFor="f-starts" className="mb-1 block text-sm">
              Começa (horário de Brasília, opcional)
            </label>
            <input id="f-starts" name="startsAt" type="datetime-local" defaultValue={toBrasiliaInput(p?.startsAt ?? null)} className={INPUT} />
            <Err id="f-starts" text={errors.startsAt} />
          </div>
          <div>
            <label htmlFor="f-ends" className="mb-1 block text-sm">
              Termina (opcional)
            </label>
            <input id="f-ends" name="endsAt" type="datetime-local" defaultValue={toBrasiliaInput(p?.endsAt ?? null)} className={INPUT} />
            <Err id="f-ends" text={errors.endsAt} />
          </div>
          <div>
            <label htmlFor="f-max" className="mb-1 block text-sm">
              Limite de usos no total (opcional)
            </label>
            <input id="f-max" name="maxRedemptions" type="number" min={1} defaultValue={p?.maxRedemptions ?? ""} className={INPUT} />
            <Err id="f-max" text={errors.maxRedemptions} />
          </div>
          <div>
            <label htmlFor="f-per" className="mb-1 block text-sm">
              Limite por cliente (opcional)
            </label>
            <input id="f-per" name="maxPerCustomer" type="number" min={1} defaultValue={p?.maxPerCustomer ?? ""} className={INPUT} />
            <Err id="f-per" text={errors.maxPerCustomer} />
          </div>
          <label className="flex gap-3 text-sm sm:col-span-2">
            <input type="checkbox" name="firstOrderOnly" defaultChecked={p?.firstOrderOnly} />
            Só na primeira compra (conferida pelo e-mail e pelo CPF)
          </label>
          <div className="sm:col-span-2">
            <label htmlFor="f-emails" className="mb-1 block text-sm">
              Só para estes clientes (e-mails separados por vírgula ou linha; opcional)
            </label>
            <textarea id="f-emails" name="allowedEmails" rows={3} defaultValue={p?.allowedEmails?.join("\n") ?? ""} className="w-full rounded-xl border border-line-strong bg-paper p-3" />
            <Err id="f-emails" text={errors.allowedEmails} />
          </div>
        </fieldset>

        <label className="flex gap-3">
          <input type="checkbox" name="active" defaultChecked={p ? p.active : true} />
          Ativa
        </label>

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={navigation.state !== "idle"}>
            {navigation.state === "submitting" ? "Salvando…" : "Salvar"}
          </Button>
          <Link to="/admin/discounts" className="self-center text-sm underline underline-offset-4">
            Cancelar
          </Link>
        </div>
      </Form>
    </div>
  );
}
