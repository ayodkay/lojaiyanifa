// /checkout — guest checkout: contact + CPF (required, owner decision), delivery
// (flat rate or pickup), Pix. The cart lives in the browser, so the form renders
// after hydration; the action re-validates everything and creates the order in
// one transaction (app/.server/orders.ts), then redirects to the order page with
// its Pix code. Private: never cached, never indexed.
import { type ComponentProps, useEffect, useState } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { env } from "~/.server/env";
import { CartChangedError, createOrder, loadOrderDeps, ShippingUnavailableError } from "~/.server/orders";
import { parsePixKey, PixConfigError } from "~/.server/pix";
import { getContent } from "~/.server/prismic";
import { getPaymentSettings, getShippingSettings, ShippingConfigError } from "~/.server/settings";
import { Breadcrumbs, Button, ButtonLink, cx, Notice } from "~/components/ui";
import { formatCep, normalizeCep, UFS } from "~/lib/br";
import type { CartQuoteResponse } from "~/lib/cart/quote";
import { checkoutFieldErrors, checkoutFormToObject, checkoutSchema } from "~/lib/checkout";
import { type CartItem, useCart } from "~/lib/client-store";
import { NO_STORE, noStore } from "~/lib/http";
import { formatBRL } from "~/lib/money";
import { seoMeta } from "~/lib/seo";
import { type ShippingMethodId, type ShippingOption, shippingOptions } from "~/lib/store-settings";
import { useCartQuote } from "~/lib/use-cart-quote";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/checkout";

const UNAVAILABLE = "O checkout está temporariamente indisponível. Fale conosco para concluir sua compra — seu carrinho continua salvo.";

export async function loader() {
  const { settings } = await getContent();
  const base = { siteUrl: env().SITE_URL, storeName: settings.storeName };
  try {
    const [payment, shipping] = await Promise.all([getPaymentSettings(), getShippingSettings()]);
    parsePixKey(payment.pix.key); // a bad key must block checkout before anyone types their details
    const options = { any: shippingOptions(shipping, { pickupOnly: false }), pickupOnly: shippingOptions(shipping, { pickupOnly: true }) };
    if (options.any.length === 0 && options.pickupOnly.length === 0) {
      console.error("[checkout] no delivery method enabled in settings/shipping");
      return { ...base, unavailable: UNAVAILABLE, options, expiryHours: payment.expiryHours };
    }
    return { ...base, unavailable: null, options, expiryHours: payment.expiryHours };
  } catch (error) {
    if (error instanceof PixConfigError || error instanceof ShippingConfigError) {
      console.error("[checkout] store not configured:", error.message);
      return { ...base, unavailable: UNAVAILABLE, options: { any: [], pickupOnly: [] }, expiryHours: 24 };
    }
    throw error;
  }
}

interface ActionResult {
  fieldErrors?: Record<string, string>;
  formError?: string;
  cartChanged?: boolean;
}

export async function action({ request }: Route.ActionArgs) {
  const parsed = checkoutSchema.safeParse(checkoutFormToObject(await request.formData()));
  if (!parsed.success) {
    return data<ActionResult>({ fieldErrors: checkoutFieldErrors(parsed.error) }, { status: 400, headers: NO_STORE });
  }
  try {
    const order = await createOrder(parsed.data, await loadOrderDeps());
    return redirect(`/order-confirmation/${order.number}?t=${encodeURIComponent(order.accessToken)}&novo=1`, { headers: NO_STORE });
  } catch (error) {
    if (error instanceof CartChangedError) {
      return data<ActionResult>(
        { cartChanged: true, formError: "Alguns itens do seu carrinho mudaram de preço ou de estoque. Revise o carrinho antes de finalizar." },
        { status: 409, headers: NO_STORE },
      );
    }
    if (error instanceof ShippingUnavailableError) {
      return data<ActionResult>(
        { fieldErrors: { shippingMethod: "Esta forma de entrega não está disponível para os itens do carrinho." } },
        { status: 400, headers: NO_STORE },
      );
    }
    if (error instanceof PixConfigError || error instanceof ShippingConfigError) {
      console.error("[checkout] store not configured:", error.message);
      return data<ActionResult>({ formError: UNAVAILABLE }, { status: 503, headers: NO_STORE });
    }
    throw error;
  }
}

export const headers = noStore;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Finalizar compra" }, { name: "robots", content: "noindex, nofollow" }];
  return seoMeta({ siteUrl: loaderData.siteUrl, storeName: loaderData.storeName, path: "/checkout", title: "Finalizar compra", noindex: true });
}

// --- page ------------------------------------------------------------------------------------

export default function Checkout({ loaderData, actionData }: Route.ComponentProps) {
  const hydrated = useHydrated();
  const items = useCart();
  const { data: quote, failed, retry } = useCartQuote(items, hydrated && !loaderData.unavailable);

  let body: React.ReactNode;
  if (loaderData.unavailable) body = <Notice tone="danger">{loaderData.unavailable}</Notice>;
  else if (!hydrated || (items.length > 0 && !quote && !failed)) body = <p role="status" className="text-muted">Carregando seu pedido…</p>;
  else if (items.length === 0) {
    body = (
      <div className="space-y-6">
        <p className="text-lg text-muted">Seu carrinho está vazio.</p>
        <ButtonLink to="/collections/all">Explorar produtos</ButtonLink>
      </div>
    );
  } else if (!quote) {
    body = (
      <div className="max-w-xl space-y-4">
        <Notice tone="danger">Não foi possível carregar os preços. Verifique sua conexão e tente novamente.</Notice>
        <Button variant="secondary" onClick={retry}>
          Tentar novamente
        </Button>
      </div>
    );
  } else if (!quote.quote.ready) {
    body = (
      <div className="max-w-xl space-y-4">
        <Notice tone="warning">Alguns itens do carrinho estão indisponíveis ou com estoque menor. Revise o carrinho para continuar.</Notice>
        <ButtonLink to="/cart">Revisar carrinho</ButtonLink>
      </div>
    );
  } else {
    body = (
      <CheckoutForm
        items={items}
        quote={quote}
        options={quote.pickupOnly ? loaderData.options.pickupOnly : loaderData.options.any}
        expiryHours={loaderData.expiryHours}
        result={actionData}
      />
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <Breadcrumbs
        items={[
          { name: "Início", href: "/" },
          { name: "Carrinho", href: "/cart" },
          { name: "Finalizar compra", href: "/checkout" },
        ]}
      />
      <h1 className="mb-10 mt-8 text-4xl md:text-6xl">Finalizar compra</h1>
      {body}
    </div>
  );
}

const EMPTY_ADDRESS = { cep: "", street: "", number: "", complement: "", neighborhood: "", city: "", state: "" };
type CepStatus = "idle" | "loading" | "found" | "not_found" | "error";

function CheckoutForm({
  items,
  quote,
  options,
  expiryHours,
  result,
}: {
  items: CartItem[];
  quote: CartQuoteResponse;
  options: ShippingOption[];
  expiryHours: number;
  result: ActionResult | undefined;
}) {
  const navigation = useNavigation();
  const submitting = navigation.state !== "idle" && navigation.formAction === "/checkout";
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  const [method, setMethod] = useState<ShippingMethodId | "">(options.length === 1 ? options[0]!.id : "");
  const [address, setAddress] = useState(EMPTY_ADDRESS);
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");
  const errors = result?.fieldErrors ?? {};
  const selected = options.find((o) => o.id === method) ?? null;

  // After a rejected submit, move focus to the first field that needs attention.
  useEffect(() => {
    if (!result) return;
    const target = document.querySelector<HTMLElement>('[aria-invalid="true"], [data-form-error]');
    target?.focus();
  }, [result]);

  const lookupCep = async (raw: string) => {
    const cep = normalizeCep(raw);
    if (!cep) return;
    setCepStatus("loading");
    try {
      const res = await fetch(`https://viacep.com.br/ws/${cep}/json/`);
      const found = (await res.json()) as { erro?: boolean; logradouro?: string; bairro?: string; localidade?: string; uf?: string };
      if (!res.ok || found.erro) {
        setCepStatus("not_found");
        return;
      }
      setAddress((a) => ({
        ...a,
        cep: formatCep(cep),
        street: found.logradouro || a.street,
        neighborhood: found.bairro || a.neighborhood,
        city: found.localidade || a.city,
        state: found.uf || a.state,
      }));
      setCepStatus("found");
    } catch (error) {
      console.warn("[checkout] ViaCEP lookup failed", error);
      setCepStatus("error");
    }
  };
  const setField = (name: keyof typeof EMPTY_ADDRESS) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setAddress((a) => ({ ...a, [name]: e.target.value }));

  const shippingCents = selected?.priceCents ?? 0;
  const cepHint = { idle: "Preenchemos o endereço a partir do CEP.", loading: "Buscando endereço…", found: "Endereço encontrado. Confira e informe o número.", not_found: "CEP não encontrado. Preencha o endereço manualmente.", error: "Não foi possível buscar o CEP agora. Preencha o endereço manualmente." }[cepStatus];

  return (
    <Form method="post" noValidate className="grid gap-10 lg:grid-cols-[1fr_24rem]">
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      <div className="min-w-0 space-y-10">
        {result?.formError && (
          <div data-form-error tabIndex={-1} className="outline-none">
            <Notice tone="danger">
              {result.formError}{" "}
              {result.cartChanged && (
                <Link to="/cart" className="underline underline-offset-4">
                  Revisar carrinho
                </Link>
              )}
            </Notice>
          </div>
        )}
        {errors.items && <Notice tone="danger">{errors.items}</Notice>}

        <fieldset className="space-y-4">
          <legend className="mb-4 text-2xl">1. Seus dados</legend>
          <Field name="name" label="Nome completo" autoComplete="name" required error={errors.name} />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field name="email" label="E-mail" type="email" autoComplete="email" required error={errors.email} />
            <Field name="phone" label="Celular (WhatsApp)" type="tel" autoComplete="tel-national" placeholder="(21) 99999-9999" required error={errors.phone} />
          </div>
          <Field
            name="cpf"
            label="CPF"
            inputMode="numeric"
            placeholder="000.000.000-00"
            required
            error={errors.cpf}
            hint="Necessário para emitir a nota fiscal do pedido."
            className="sm:max-w-xs"
          />
        </fieldset>

        <fieldset className="space-y-4" aria-describedby={errors.shippingMethod ? "f-shippingMethod-erro" : undefined}>
          <legend className="mb-4 text-2xl">2. Entrega</legend>
          <div className="space-y-3">
            {options.map((option) => (
              <label
                key={option.id}
                className={cx(
                  "flex cursor-pointer gap-3 border p-4 transition-colors",
                  method === option.id ? "border-ink bg-surface" : "border-line hover:border-line-strong",
                )}
              >
                <input
                  type="radio"
                  name="shippingMethod"
                  value={option.id}
                  checked={method === option.id}
                  onChange={() => setMethod(option.id)}
                  aria-invalid={errors.shippingMethod ? true : undefined}
                  className="mt-1"
                />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap justify-between gap-2">
                    <span className="font-medium">{option.label}</span>
                    <span>{option.priceCents === 0 ? "Grátis" : formatBRL(option.priceCents)}</span>
                  </span>
                  {option.address && <span className="mt-1 block text-sm text-muted">{option.address}</span>}
                  <span className="mt-1 block text-sm text-muted">{deliveryEstimate(option)}</span>
                  {option.instructions && <span className="mt-1 block text-sm text-muted">{option.instructions}</span>}
                </span>
              </label>
            ))}
          </div>
          {errors.shippingMethod && (
            <p id="f-shippingMethod-erro" className="text-sm text-danger">
              {errors.shippingMethod}
            </p>
          )}

          {selected?.needsAddress && (
            <div className="space-y-4 border-t border-line pt-6">
              {errors.address && <p className="text-sm text-danger">{errors.address}</p>}
              <Field
                name="cep"
                label="CEP"
                inputMode="numeric"
                autoComplete="postal-code"
                placeholder="00000-000"
                required
                value={address.cep}
                onChange={(e) => {
                  setField("cep")(e);
                  if (normalizeCep(e.target.value)) void lookupCep(e.target.value);
                }}
                error={errors.cep}
                hint={cepHint}
                className="sm:max-w-xs"
              />
              <Field name="street" label="Rua" autoComplete="address-line1" required value={address.street} onChange={setField("street")} error={errors.street} />
              <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
                <Field name="number" label="Número" required value={address.number} onChange={setField("number")} error={errors.number} />
                <Field name="complement" label="Complemento (opcional)" autoComplete="address-line2" value={address.complement} onChange={setField("complement")} error={errors.complement} />
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
                <Field name="neighborhood" label="Bairro" required value={address.neighborhood} onChange={setField("neighborhood")} error={errors.neighborhood} />
                <Field name="city" label="Cidade" autoComplete="address-level2" required value={address.city} onChange={setField("city")} error={errors.city} />
                <div>
                  <label htmlFor="f-state" className="mb-1 block text-sm">
                    Estado
                  </label>
                  <select
                    id="f-state"
                    name="state"
                    required
                    autoComplete="address-level1"
                    value={address.state}
                    onChange={setField("state")}
                    aria-invalid={errors.state ? true : undefined}
                    aria-describedby={errors.state ? "f-state-erro" : undefined}
                    className={cx("min-h-11 w-full rounded-[var(--radius-control)] border bg-paper px-3", errors.state ? "border-danger" : "border-line-strong")}
                  >
                    <option value="">UF</option>
                    {UFS.map((uf) => (
                      <option key={uf} value={uf}>
                        {uf}
                      </option>
                    ))}
                  </select>
                  {errors.state && (
                    <p id="f-state-erro" className="mt-1 text-sm text-danger">
                      {errors.state}
                    </p>
                  )}
                </div>
              </div>
            </div>
          )}
        </fieldset>

        <fieldset>
          <legend className="mb-4 text-2xl">3. Pagamento</legend>
          <div className="border border-line bg-surface p-4 text-sm">
            <p className="font-medium">Pix</p>
            <p className="mt-1 text-muted">
              Na próxima tela você verá o QR Code e o código “copia e cola”. Os itens ficam reservados por {expiryHours} horas aguardando o
              pagamento.
            </p>
          </div>
        </fieldset>

        <div>
          <label className="flex gap-3 text-sm">
            <input
              type="checkbox"
              name="acceptTerms"
              required
              aria-invalid={errors.acceptTerms ? true : undefined}
              aria-describedby={errors.acceptTerms ? "f-acceptTerms-erro" : undefined}
              className="mt-0.5"
            />
            <span>
              Li e aceito os{" "}
              <Link to="/terms" target="_blank" rel="noopener" className="underline underline-offset-4">
                termos de uso
              </Link>{" "}
              e a{" "}
              <Link to="/privacy" target="_blank" rel="noopener" className="underline underline-offset-4">
                política de privacidade
              </Link>
              .
            </span>
          </label>
          {errors.acceptTerms && (
            <p id="f-acceptTerms-erro" className="mt-1 text-sm text-danger">
              {errors.acceptTerms}
            </p>
          )}
        </div>
      </div>

      <aside aria-labelledby="resumo" className="h-fit border border-line bg-surface p-6 lg:sticky lg:top-28">
        <h2 id="resumo" className="text-2xl">
          Seu pedido
        </h2>
        <ul className="mt-6 space-y-3 text-sm">
          {quote.quote.lines.map((line) => (
            <li key={line.sku} className="flex justify-between gap-4">
              <span className="min-w-0">
                {line.name}
                {line.variantName && <span className="text-muted"> — {line.variantName}</span>}
                <span className="text-muted"> × {line.quantity}</span>
              </span>
              <span className="shrink-0">{formatBRL(line.lineTotalCents)}</span>
            </li>
          ))}
        </ul>
        <dl className="mt-6 space-y-3 border-t border-line pt-4 text-sm">
          <div className="flex justify-between gap-4">
            <dt>Subtotal</dt>
            <dd>{formatBRL(quote.quote.subtotalCents)}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt>Entrega</dt>
            <dd className={cx(!selected && "text-muted")}>{selected ? (selected.priceCents === 0 ? "Grátis" : formatBRL(selected.priceCents)) : "Escolha a entrega"}</dd>
          </div>
          <div className="flex justify-between gap-4 border-t border-line pt-3 text-base font-medium">
            <dt>Total</dt>
            <dd>{formatBRL(quote.quote.subtotalCents + shippingCents)}</dd>
          </div>
        </dl>
        <Button type="submit" className="mt-6 w-full" disabled={submitting}>
          {submitting ? "Finalizando…" : "Finalizar pedido"}
        </Button>
        <p className="mt-4 text-xs text-muted">Pagamento via Pix. Os preços e o estoque são confirmados ao finalizar.</p>
      </aside>
    </Form>
  );
}

function deliveryEstimate(option: ShippingOption): string {
  const days = option.estimateDays;
  if (option.id === "pickup") {
    return days ? `Disponível para retirada em até ${days.max} dia${days.max === 1 ? "" : "s"} útil${days.max === 1 ? "" : "eis"} após a confirmação do pagamento.` : "Avisaremos quando estiver pronto para retirada.";
  }
  return days ? `Entrega em ${days.min} a ${days.max} dias úteis após a confirmação do pagamento.` : "O prazo de entrega é informado no envio.";
}

function Field({
  name,
  label,
  error,
  hint,
  className,
  ...input
}: { name: string; label: string; error?: string; hint?: string } & ComponentProps<"input">) {
  const id = `f-${name}`;
  const describedBy = [error ? `${id}-erro` : null, hint ? `${id}-dica` : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-sm">
        {label}
      </label>
      <input
        id={id}
        name={name}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy}
        className={cx("min-h-11 w-full rounded-[var(--radius-control)] border bg-paper px-3", error ? "border-danger" : "border-line-strong")}
        {...input}
      />
      {hint && (
        <p id={`${id}-dica`} className="mt-1 text-xs text-muted" aria-live="polite">
          {hint}
        </p>
      )}
      {error && (
        <p id={`${id}-erro`} className="mt-1 text-sm text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
