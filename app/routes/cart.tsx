// /cart — the shopping cart. The cart lives in the browser (localStorage, so it
// works for guests); the server only renders the page shell, and the browser
// asks POST /api/cart/quote for current prices, stock and totals.
// Private page: never cached, never indexed.
import { Link } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { CouponBox, DiscountRows } from "~/components/discounts";
import { ProductGrid } from "~/components/product-card";
import { Breadcrumbs, Button, ButtonLink, cx, Notice, Price, ProductImage, SectionHeading } from "~/components/ui";
import { MAX_LINE_QUANTITY } from "~/lib/cart/limits";
import type { CartQuoteResponse, QuoteLine } from "~/lib/cart/quote";
import { type Adjustment, useCartQuote } from "~/lib/use-cart-quote";
import { cart, type CartItem, useCart, useCoupon } from "~/lib/client-store";
import { noStore } from "~/lib/http";
import { formatBRL, percentOff } from "~/lib/money";
import { seoMeta } from "~/lib/seo";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/cart";

export async function loader() {
  const { settings } = await getContent();
  return { siteUrl: env().SITE_URL, storeName: settings.storeName };
}

export const headers = noStore;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Carrinho" }, { name: "robots", content: "noindex, nofollow" }];
  return seoMeta({ siteUrl: loaderData.siteUrl, storeName: loaderData.storeName, path: "/cart", title: "Carrinho", noindex: true });
}

// --- page --------------------------------------------------------------------------------------

export default function Cart() {
  const hydrated = useHydrated();
  const items = useCart();
  const couponCode = useCoupon();
  const { data, pending, failed, adjustments, dismissAdjustments, retry } = useCartQuote(items, hydrated, couponCode);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <Breadcrumbs
        items={[
          { name: "Início", href: "/" },
          { name: "Carrinho", href: "/cart" },
        ]}
      />
      <h1 className="mb-10 mt-8 text-4xl md:text-6xl">Carrinho</h1>

      {!hydrated || (items.length > 0 && !data && !failed) ? (
        <p role="status" className="text-muted">
          Carregando seu carrinho…
        </p>
      ) : items.length === 0 ? (
        <EmptyCart />
      ) : !data ? (
        <QuoteError onRetry={retry} />
      ) : (
        <CartView
          items={items}
          data={data}
          couponCode={couponCode}
          pending={pending}
          failed={failed}
          adjustments={adjustments}
          onDismissAdjustments={dismissAdjustments}
          onRetry={retry}
        />
      )}
    </div>
  );
}

function EmptyCart() {
  return (
    <div className="max-w-xl space-y-6">
      <p className="text-lg text-muted">Seu carrinho está vazio.</p>
      <ButtonLink to="/collections/all">Explorar produtos</ButtonLink>
    </div>
  );
}

function QuoteError({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="max-w-xl space-y-4">
      <Notice tone="danger">
        Não foi possível carregar os preços do seu carrinho. Verifique sua conexão e tente novamente. Seus itens continuam
        salvos.
      </Notice>
      <Button variant="secondary" onClick={onRetry}>
        Tentar novamente
      </Button>
    </div>
  );
}

function CartView({
  items,
  data,
  couponCode,
  pending,
  failed,
  adjustments,
  onDismissAdjustments,
  onRetry,
}: {
  items: CartItem[];
  data: CartQuoteResponse;
  couponCode: string | null;
  pending: boolean;
  failed: boolean;
  adjustments: Adjustment[];
  onDismissAdjustments: () => void;
  onRetry: () => void;
}) {
  const { quote, recommendations, discount } = data;
  const linesBySku = new Map(quote.lines.map((l) => [l.sku, l]));
  const blocked = quote.lines.filter((l) => l.problem === "unavailable" || l.problem === "out_of_stock");
  const canCheckout = quote.ready && !pending && !failed;

  return (
    <>
      <div className="mb-6 space-y-3">
        {adjustments.length > 0 && (
          <Notice tone="warning">
            <p>Ajustamos a quantidade de alguns itens ao estoque disponível:</p>
            <ul className="mt-2 list-disc pl-5">
              {adjustments.map((a) => (
                <li key={a.sku}>
                  {a.name}: de {a.from} para {a.to}
                </li>
              ))}
            </ul>
            <button type="button" className="mt-2 underline underline-offset-4" onClick={onDismissAdjustments}>
              Entendi
            </button>
          </Notice>
        )}
        {failed && (
          <Notice tone="danger">
            Não foi possível atualizar o carrinho; os valores abaixo podem estar desatualizados.{" "}
            <button type="button" className="underline underline-offset-4" onClick={onRetry}>
              Tentar novamente
            </button>
          </Notice>
        )}
      </div>

      <div className="grid gap-10 lg:grid-cols-[1fr_22rem]">
        <section aria-labelledby="itens">
          <h2 id="itens" className="sr-only">
            Itens do carrinho
          </h2>
          <ul aria-busy={pending} className={cx("border-t border-line transition-opacity", pending && "opacity-70")}>
            {items.map((item) => (
              <CartLine key={item.sku} item={item} line={linesBySku.get(item.sku) ?? null} />
            ))}
          </ul>
          <Link to="/collections/all" className="mt-6 inline-block text-sm underline underline-offset-4">
            ← Continuar comprando
          </Link>
        </section>

        <aside aria-labelledby="resumo" className="h-fit border border-line bg-surface p-6 lg:sticky lg:top-28">
          <h2 id="resumo" className="text-2xl">
            Resumo do pedido
          </h2>
          <dl aria-live="polite" className="mt-6 space-y-3 text-sm">
            <div className="flex justify-between gap-4">
              <dt>
                Subtotal ({quote.itemCount} {quote.itemCount === 1 ? "item" : "itens"})
              </dt>
              <dd>{formatBRL(quote.subtotalCents)}</dd>
            </div>
            {quote.savingsCents > 0 && (
              <div className="flex justify-between gap-4 text-sale">
                <dt>Você economiza</dt>
                <dd>{formatBRL(quote.savingsCents)}</dd>
              </div>
            )}
            <DiscountRows discount={discount} />
            <div className="flex justify-between gap-4">
              <dt>Frete</dt>
              <dd className="text-muted">{discount.freeShipping ? "Grátis" : "Calculado no checkout"}</dd>
            </div>
            <div className="flex justify-between gap-4 border-t border-line pt-3 text-base font-medium">
              <dt>Total</dt>
              <dd>{formatBRL(quote.totalCents - discount.itemsDiscountCents)}</dd>
            </div>
          </dl>
          <div className="mt-6 border-t border-line pt-4">
            <CouponBox current={couponCode} discount={discount} />
          </div>

          {canCheckout ? (
            <ButtonLink to="/checkout" className="mt-6 w-full">
              Finalizar compra
            </ButtonLink>
          ) : (
            <Button className="mt-6 w-full" disabled>
              {pending ? "Atualizando…" : "Finalizar compra"}
            </Button>
          )}
          {blocked.length > 0 && (
            <div className="mt-4 space-y-2 text-sm">
              <p className="text-danger">Remova os itens indisponíveis para finalizar a compra.</p>
              <Button variant="secondary" className="w-full" onClick={() => blocked.forEach((l) => cart.remove(l.sku))}>
                Remover itens indisponíveis
              </Button>
            </div>
          )}
          <p className="mt-6 text-xs text-muted">Pagamento via Pix. Os preços e o estoque são confirmados ao finalizar.</p>
        </aside>
      </div>

      {recommendations.length > 0 && (
        <section aria-labelledby="sugestoes" className="mt-20">
          <SectionHeading id="sugestoes" title="Combina com o seu pedido" />
          <ProductGrid products={recommendations} />
        </section>
      )}
    </>
  );
}

const PROBLEM_TEXT: Record<NonNullable<QuoteLine["problem"]>, string> = {
  unavailable: "Este item não está disponível para compra no momento.",
  out_of_stock: "Esgotado no momento.",
  quantity_reduced: "Quantidade ajustada ao estoque disponível.",
};

function CartLine({ item, line }: { item: CartItem; line: QuoteLine | null }) {
  if (!line) {
    // Just added or switched variant: the next quote fills it in.
    return (
      <li aria-busy="true" className="border-b border-line py-6 text-sm text-muted">
        Atualizando item…
      </li>
    );
  }

  const href = line.uid
    ? `/products/${line.uid}${line.variantChoices.length > 0 ? `?variante=${encodeURIComponent(line.sku)}` : ""}`
    : null;
  const sellable = line.problem !== "unavailable" && line.problem !== "out_of_stock";
  const max = Math.max(1, Math.min(MAX_LINE_QUANTITY, line.maxQuantity));
  const discount =
    line.unitPriceCents !== null && line.originalUnitPriceCents !== null ? percentOff(line.unitPriceCents, line.originalUnitPriceCents) : null;
  const setQuantity = (q: number) => cart.setQuantity(item.sku, Math.min(max, Math.max(1, Math.floor(q) || 1)));
  const image = <ProductImage image={line.image} name={line.name} sizes="8rem" aspect="4 / 5" />;

  return (
    <li className="grid grid-cols-[5.5rem_1fr] gap-4 border-b border-line py-6 sm:grid-cols-[8rem_1fr_auto] sm:gap-6">
      <div className={cx(!sellable && "opacity-50")}>
        {href ? (
          <Link to={href} tabIndex={-1} aria-hidden="true">
            {image}
          </Link>
        ) : (
          image
        )}
      </div>

      <div className="min-w-0 space-y-3">
        <div>
          <h3 className="text-lg leading-snug">
            {href ? (
              <Link to={href} className="hover:underline">
                {line.name}
              </Link>
            ) : (
              line.name
            )}
          </h3>
          {line.variantName && <p className="text-sm text-muted">{line.variantName}</p>}
          <p className="text-xs text-muted">SKU: {line.sku}</p>
        </div>

        {line.unitPriceCents !== null && sellable && (
          <Price cents={line.unitPriceCents} originalCents={line.originalUnitPriceCents} discountPercent={discount} className="text-sm" />
        )}

        {line.variantChoices.length > 1 && (
          <label className="flex items-center gap-2 text-sm">
            <span>Opção</span>
            <select
              value={line.sku}
              onChange={(e) => cart.changeVariant(line.sku, e.target.value)}
              className="min-h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3"
            >
              {line.variantChoices.map((v) => (
                <option key={v.sku} value={v.sku} disabled={!v.purchasable && v.sku !== line.sku}>
                  {v.name}
                  {v.purchasable ? "" : " (indisponível)"}
                </option>
              ))}
            </select>
          </label>
        )}

        <div className="flex flex-wrap items-center gap-4">
          {sellable && (
            <div className="flex items-center rounded-full border border-line-strong">
              <button
                type="button"
                className="h-11 w-11 disabled:opacity-40"
                aria-label={`Diminuir quantidade de ${line.name}`}
                disabled={item.quantity <= 1}
                onClick={() => setQuantity(item.quantity - 1)}
              >
                −
              </button>
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={max}
                value={item.quantity}
                aria-label={`Quantidade de ${line.name}`}
                onChange={(e) => setQuantity(Number(e.target.value))}
                className="h-11 w-12 bg-transparent text-center [appearance:textfield]"
              />
              <button
                type="button"
                className="h-11 w-11 disabled:opacity-40"
                aria-label={`Aumentar quantidade de ${line.name}`}
                disabled={item.quantity >= max}
                onClick={() => setQuantity(item.quantity + 1)}
              >
                +
              </button>
            </div>
          )}
          <button
            type="button"
            className="min-h-11 text-sm underline underline-offset-4"
            aria-label={`Remover ${line.name} do carrinho`}
            onClick={() => cart.remove(item.sku)}
          >
            Remover
          </button>
        </div>

        {line.problem && line.problem !== "quantity_reduced" && <p className="text-sm text-danger">{PROBLEM_TEXT[line.problem]}</p>}
        {sellable && line.maxQuantity < MAX_LINE_QUANTITY && item.quantity >= line.maxQuantity && (
          <p className="text-sm text-muted">
            {line.maxQuantity === 1 ? "Última unidade disponível." : `Máximo de ${line.maxQuantity} unidades disponíveis.`}
          </p>
        )}
      </div>

      <p className="col-start-2 text-right font-medium sm:col-start-auto">
        {sellable ? formatBRL(line.lineTotalCents) : <span className="text-muted">—</span>}
      </p>
    </li>
  );
}
