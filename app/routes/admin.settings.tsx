// /admin/settings — the store's Pix payment, its delivery methods, and whether checkout is open. Owner decision
// 2026-11-03: saving settings never opens checkout; the owner opens it here, once both settings are valid, and
// can close it at any time. Only the owner may change anything; an admin sees the page read-only; staff can't
// open it (docs/architecture.md §3). Every action re-checks the capability on the server, and every save is
// refused when the settings changed after the page was loaded (the page then reloads to show what is stored).
import type { ComponentProps, ReactNode } from "react";
import { data, Form, type ShouldRevalidateFunctionArgs, useNavigation } from "react-router";

import { adminUserContext, requireCapability } from "~/.server/admin-guard";
import {
  type AdminSettingsView,
  CheckoutStateError,
  getAdminSettings,
  savePaymentSettings,
  saveShippingSettings,
  setCheckoutOpen,
  SettingsChangedError,
} from "~/.server/admin-settings";
import { parsePaymentForm, parseShippingForm, parseVersion } from "~/.server/settings-forms";
import { cx, Notice } from "~/components/ui";
import { adminMeta } from "~/lib/admin/meta";
import { can } from "~/lib/admin/roles";
import {
  ADDRESS_MAX,
  EXPIRY_HOURS,
  HANDLING_DAYS_MAX,
  INSTRUCTIONS_MAX,
  LABEL_MAX,
  RECEIVER_INPUT_MAX,
  TRANSIT_DAYS_MAX,
} from "~/lib/admin/settings";
import { formatBRL } from "~/lib/money";
import { PIX_CITY_MAX, PIX_NAME_MAX } from "~/lib/store-settings";

import type { Route } from "./+types/admin.settings";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "settings.view");
  return { settings: await getAdminSettings(), canEdit: can(user.role, "settings.edit") };
}

interface ActionResult {
  intent: string;
  ok?: string;
  error?: string;
  /** What keeps checkout from opening (or the change from being saved). */
  reasons?: string[];
  fieldErrors?: Record<string, string | undefined>;
}

const EXPIRED = "O formulário expirou. Recarregue a página e tente de novo.";
const CHANGED =
  "As configurações mudaram depois que você abriu esta página (em outra aba ou por outra pessoa). Nada foi alterado; a página abaixo mostra o que está salvo agora.";

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "settings.edit");
  const form = await request.formData();
  const intent = String(form.get("intent") ?? "");
  const version = parseVersion(form);
  if (version === null) return data<ActionResult>({ intent, error: EXPIRED }, { status: 400 });
  try {
    if (intent === "payment") {
      const parsed = parsePaymentForm(form);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      const { changed } = await savePaymentSettings(parsed.value, version, user);
      return data<ActionResult>({ intent, ok: changed ? "Pagamento salvo." : "Nada mudou: o pagamento já estava assim." });
    }
    if (intent === "shipping") {
      const parsed = parseShippingForm(form);
      if (!parsed.ok) return data<ActionResult>({ intent, fieldErrors: parsed.errors }, { status: 400 });
      const { changed } = await saveShippingSettings(parsed.value, version, user);
      return data<ActionResult>({ intent, ok: changed ? "Entrega salva." : "Nada mudou: a entrega já estava assim." });
    }
    if (intent === "open") {
      if (form.get("confirmed") !== "yes") {
        return data<ActionResult>({ intent, error: "Marque a caixa confirmando que conferiu o código de teste e as formas de entrega." }, { status: 400 });
      }
      const { changed } = await setCheckoutOpen(true, version, user);
      return data<ActionResult>({ intent, ok: changed ? "Checkout aberto: os clientes já podem fazer pedidos." : "O checkout já estava aberto." });
    }
    if (intent === "close") {
      const { changed } = await setCheckoutOpen(false, version, user);
      return data<ActionResult>({
        intent,
        ok: changed ? "Checkout fechado: os clientes veem o aviso de indisponível e nenhum pedido é criado." : "O checkout já estava fechado.",
      });
    }
    return data<ActionResult>({ intent, error: "Ação desconhecida." }, { status: 400 });
  } catch (error) {
    if (error instanceof SettingsChangedError) return data<ActionResult>({ intent, error: CHANGED }, { status: 409 });
    if (error instanceof CheckoutStateError) {
      return data<ActionResult>({ intent, error: "Não foi possível concluir:", reasons: error.reasons }, { status: 409 });
    }
    throw error;
  }
}

export const meta = () => adminMeta("Configurações");

/** A 409 means the stored settings aren't what this page showed: reload them (React Router skips that after 4xx). */
export function shouldRevalidate({ actionStatus, defaultShouldRevalidate }: ShouldRevalidateFunctionArgs) {
  return actionStatus === 409 ? true : defaultShouldRevalidate;
}

export default function AdminSettings({ loaderData, actionData }: Route.ComponentProps) {
  const { settings, canEdit } = loaderData;
  const busy = useNavigation().state === "submitting";
  const resultFor = (...intents: string[]) => (actionData && intents.includes(actionData.intent) ? actionData : undefined);

  return (
    <div className="max-w-3xl space-y-8">
      <div>
        <h1 className="text-3xl md:text-4xl">Configurações</h1>
        <p className="mt-2 text-sm text-muted">Pagamento Pix, formas de entrega e a abertura do checkout.</p>
      </div>
      {!canEdit && <Notice>Só quem tem a função Proprietário(a) pode alterar estas configurações. Você pode consultá-las.</Notice>}
      <CheckoutSection checkout={settings.checkout} canEdit={canEdit} busy={busy} result={resultFor("open", "close")} />
      <PaymentSection payment={settings.payment} canEdit={canEdit} busy={busy} result={resultFor("payment")} />
      <ShippingSection shipping={settings.shipping} canEdit={canEdit} busy={busy} result={resultFor("shipping")} />
    </div>
  );
}

// --- pieces -------------------------------------------------------------------------------------

const FIELD = "min-h-11 w-full rounded-[var(--radius-control)] border bg-paper px-3";
const PRIMARY =
  "rounded-[var(--radius-control)] bg-accent px-6 py-3 text-sm font-medium text-accent-contrast transition-colors hover:bg-ink-soft disabled:opacity-50";
const SECONDARY =
  "rounded-[var(--radius-control)] border border-ink px-6 py-3 text-sm font-medium transition-colors hover:bg-ink hover:text-paper disabled:opacity-50";

function Outcome({ result }: { result: ActionResult | undefined }) {
  if (result?.ok) return <Notice tone="success">{result.ok}</Notice>;
  if (!result?.error) return null;
  return (
    <Notice tone="danger">
      {result.error}
      {result.reasons && (
        <ul className="mt-1 list-disc pl-5">
          {result.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      )}
    </Notice>
  );
}

function Hint({ id, error, hint }: { id: string; error?: string; hint?: ReactNode }) {
  if (error) {
    return (
      <p id={`${id}-erro`} className="mt-1 text-danger">
        {error}
      </p>
    );
  }
  return hint ? (
    <p id={`${id}-dica`} className="mt-1 text-xs text-muted">
      {hint}
    </p>
  ) : null;
}

const describedBy = (id: string, error?: string, hint?: ReactNode) => (error ? `${id}-erro` : hint ? `${id}-dica` : undefined);

function TextField({ id, label, error, hint, className, ...input }: { id: string; label: string; error?: string; hint?: ReactNode } & ComponentProps<"input">) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block">
        {label}
      </label>
      <input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cx(FIELD, error ? "border-danger" : "border-line-strong", className)}
        {...input}
      />
      <Hint id={id} error={error} hint={hint} />
    </div>
  );
}

function TextArea({ id, label, error, hint, ...input }: { id: string; label: ReactNode; error?: string; hint?: ReactNode } & ComponentProps<"textarea">) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block">
        {label}
      </label>
      <textarea
        id={id}
        rows={2}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, error, hint)}
        className={cx("w-full rounded-md border bg-paper px-3 py-2 text-base", error ? "border-danger" : "border-line-strong")}
        {...input}
      />
      <Hint id={id} error={error} hint={hint} />
    </div>
  );
}

function Checkbox({ name, label, defaultChecked }: { name: string; label: string; defaultChecked: boolean }) {
  return (
    <label className="flex items-center gap-3">
      <input type="checkbox" name={name} value="yes" defaultChecked={defaultChecked} className="size-5 shrink-0 accent-ink" />
      {label}
    </label>
  );
}

function Section({ id, title, children }: { id: string; title: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-4 border border-line bg-surface p-5 text-sm">
      <h2 id={id} className="text-xl">
        {title}
      </h2>
      {children}
    </section>
  );
}

// --- checkout -------------------------------------------------------------------------------------

function CheckoutSection({
  checkout,
  canEdit,
  busy,
  result,
}: {
  checkout: AdminSettingsView["checkout"];
  canEdit: boolean;
  busy: boolean;
  result: ActionResult | undefined;
}) {
  return (
    <Section id="checkout" title="Checkout">
      {checkout.open ? (
        <p>
          O checkout está <strong>aberto</strong>: os clientes podem fazer pedidos.
        </p>
      ) : (
        <p>
          O checkout está <strong>fechado</strong>: a página de finalizar compra pede que o cliente fale com a loja, e nenhum pedido é criado.
        </p>
      )}
      <Outcome result={result} />
      {!checkout.open && checkout.blockers.length > 0 && (
        <div>
          <p>Para abrir o checkout:</p>
          <ul className="mt-1 list-disc pl-5 text-muted">
            {checkout.blockers.map((blocker) => (
              <li key={blocker}>{blocker}</li>
            ))}
          </ul>
        </div>
      )}
      {canEdit && checkout.open && (
        <Form method="post" key={checkout.version}>
          <input type="hidden" name="intent" value="close" />
          <input type="hidden" name="version" value={checkout.version} />
          <button type="submit" disabled={busy} className={SECONDARY}>
            Fechar checkout
          </button>
        </Form>
      )}
      {canEdit && !checkout.open && checkout.blockers.length === 0 && (
        <Form method="post" key={checkout.version} className="space-y-3">
          <input type="hidden" name="intent" value="open" />
          <input type="hidden" name="version" value={checkout.version} />
          <label className="flex items-start gap-3">
            <input type="checkbox" name="confirmed" value="yes" required className="mt-0.5 size-5 shrink-0 accent-ink" />
            <span>Li o código de teste abaixo no app do banco (sem pagar), conferi o recebedor e as formas de entrega.</span>
          </label>
          <button type="submit" disabled={busy} className={PRIMARY}>
            Abrir checkout
          </button>
        </Form>
      )}
    </Section>
  );
}

// --- payment --------------------------------------------------------------------------------------

function PaymentSection({
  payment,
  canEdit,
  busy,
  result,
}: {
  payment: AdminSettingsView["payment"];
  canEdit: boolean;
  busy: boolean;
  result: ActionResult | undefined;
}) {
  const errors = result?.fieldErrors ?? {};
  const pix = payment.values?.pix;
  return (
    <Section id="pagamento" title="Pagamento (Pix)">
      {payment.problem && <Notice tone="danger">{payment.problem}</Notice>}
      <Outcome result={result} />
      {/* key: a new stored version brings fresh fields */}
      <Form method="post" key={payment.version} className="space-y-4">
        <input type="hidden" name="intent" value="payment" />
        <input type="hidden" name="version" value={payment.version} />
        <fieldset disabled={!canEdit} className="space-y-4">
          <TextField
            id="pix-key"
            name="pixKey"
            label="Chave Pix"
            defaultValue={pix?.key ?? ""}
            required
            autoComplete="off"
            spellCheck={false}
            maxLength={77}
            error={errors.pixKey}
            hint={payment.keyType ? `Tipo: ${payment.keyType}.` : "CPF, CNPJ, e-mail, telefone (+55 DDD número) ou chave aleatória."}
          />
          <TextField
            id="pix-name"
            name="merchantName"
            label="Nome do recebedor"
            defaultValue={pix?.merchantName ?? ""}
            required
            maxLength={RECEIVER_INPUT_MAX}
            error={errors.merchantName}
            hint={
              payment.printed
                ? `No código Pix: ${payment.printed.name}. O app do banco mostra o nome do titular da conta.`
                : `No código Pix aparecem até ${PIX_NAME_MAX} caracteres, sem acentos.`
            }
          />
          <TextField
            id="pix-city"
            name="merchantCity"
            label="Cidade do recebedor"
            defaultValue={pix?.merchantCity ?? ""}
            required
            maxLength={RECEIVER_INPUT_MAX}
            error={errors.merchantCity}
            hint={payment.printed ? `No código Pix: ${payment.printed.city}.` : `No código Pix aparecem até ${PIX_CITY_MAX} caracteres, sem acentos.`}
          />
          <TextField
            id="pix-expiry"
            name="expiryHours"
            label="Prazo para pagar (horas)"
            type="number"
            inputMode="numeric"
            min={EXPIRY_HOURS.min}
            max={EXPIRY_HOURS.max}
            step={1}
            defaultValue={payment.values?.expiryHours ?? 24}
            required
            className="w-32"
            error={errors.expiryHours}
            hint="Pedidos não pagos são cancelados depois deste prazo e os itens voltam à venda."
          />
        </fieldset>
        {canEdit && (
          <>
            <p className="text-muted">Pedidos já feitos continuam com o código Pix e o prazo que receberam.</p>
            <button type="submit" disabled={busy} className={PRIMARY}>
              Salvar pagamento
            </button>
          </>
        )}
      </Form>
      {payment.test && (
        <div className="space-y-3 border-t border-line pt-4">
          <h3 className="text-base font-medium">Código de teste ({formatBRL(100)})</h3>
          <p className="text-muted">
            Leia este código no app do banco e confira o nome do recebedor. <strong className="text-ink">Não conclua o pagamento.</strong>
          </p>
          <img src={payment.test.qr} alt="Código QR de teste do Pix" width={192} height={192} className="size-48 border border-line bg-white p-2" />
          <TextArea id="pix-teste" label="Pix copia e cola" readOnly rows={3} value={payment.test.brCode} />
        </div>
      )}
    </Section>
  );
}

// --- shipping -------------------------------------------------------------------------------------

function ShippingSection({
  shipping,
  canEdit,
  busy,
  result,
}: {
  shipping: AdminSettingsView["shipping"];
  canEdit: boolean;
  busy: boolean;
  result: ActionResult | undefined;
}) {
  const errors = result?.fieldErrors ?? {};
  const values = shipping.values;
  const transitError = errors.transitDays;
  return (
    <Section id="entrega" title="Entrega">
      {shipping.problem && <Notice tone="danger">{shipping.problem}</Notice>}
      <Outcome result={result} />
      <Form method="post" key={shipping.version} className="space-y-6">
        <input type="hidden" name="intent" value="shipping" />
        <input type="hidden" name="version" value={shipping.version} />
        <fieldset disabled={!canEdit} className="space-y-6">
          <TextField
            id="handling-days"
            name="handlingDays"
            label="Dias para preparar o pedido"
            type="number"
            inputMode="numeric"
            min={0}
            max={HANDLING_DAYS_MAX}
            step={1}
            defaultValue={values?.handlingDays ?? 1}
            required
            className="w-32"
            error={errors.handlingDays}
            hint="Dias úteis depois da confirmação do pagamento, somados ao prazo da transportadora na estimativa mostrada ao cliente."
          />

          <fieldset className="space-y-3 border-t border-line pt-4">
            <legend className="pt-4 font-medium">Entrega para todo o Brasil (frete fixo)</legend>
            <Checkbox name="flatRateEnabled" label="Oferecer no checkout" defaultChecked={values?.flatRate.enabled ?? true} />
            <TextField
              id="flat-label"
              name="flatRateLabel"
              label="Nome mostrado ao cliente"
              defaultValue={values?.flatRate.label ?? "Entrega em todo o Brasil"}
              required
              maxLength={LABEL_MAX}
              error={errors.flatRateLabel}
            />
            <TextField
              id="flat-price"
              name="flatRatePrice"
              label="Valor (R$)"
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              defaultValue={values ? (values.flatRate.priceCents / 100).toFixed(2) : ""}
              required
              className="w-40"
              error={errors.flatRatePrice}
            />
            <fieldset aria-describedby={transitError ? "transito-erro" : "transito-dica"}>
              <legend className="mb-1">Prazo da transportadora (dias úteis)</legend>
              <div className="flex items-center gap-3">
                <label htmlFor="transit-min">de</label>
                <input
                  id="transit-min"
                  name="transitMin"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={TRANSIT_DAYS_MAX}
                  step={1}
                  defaultValue={values?.flatRate.transitDays?.min ?? ""}
                  aria-invalid={transitError ? true : undefined}
                  className={cx(FIELD, "w-24", transitError ? "border-danger" : "border-line-strong")}
                />
                <label htmlFor="transit-max">a</label>
                <input
                  id="transit-max"
                  name="transitMax"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={TRANSIT_DAYS_MAX}
                  step={1}
                  defaultValue={values?.flatRate.transitDays?.max ?? ""}
                  aria-invalid={transitError ? true : undefined}
                  className={cx(FIELD, "w-24", transitError ? "border-danger" : "border-line-strong")}
                />
              </div>
              <Hint id="transito" error={transitError} hint="Deixe os dois em branco para não mostrar prazo de entrega ao cliente." />
            </fieldset>
          </fieldset>

          <fieldset className="space-y-3 border-t border-line pt-4">
            <legend className="pt-4 font-medium">Retirada na loja</legend>
            <Checkbox name="pickupEnabled" label="Oferecer no checkout" defaultChecked={values?.pickup.enabled ?? true} />
            <TextField
              id="pickup-label"
              name="pickupLabel"
              label="Nome mostrado ao cliente"
              defaultValue={values?.pickup.label ?? "Retirar na loja"}
              required
              maxLength={LABEL_MAX}
              error={errors.pickupLabel}
            />
            <TextArea
              id="pickup-address"
              name="pickupAddress"
              label="Endereço de retirada"
              defaultValue={values?.pickup.address ?? ""}
              required
              maxLength={ADDRESS_MAX}
              error={errors.pickupAddress}
            />
            <TextArea
              id="pickup-instructions"
              name="pickupInstructions"
              label={
                <>
                  Instruções <span className="text-muted">(opcional)</span>
                </>
              }
              defaultValue={values?.pickup.instructions ?? ""}
              maxLength={INSTRUCTIONS_MAX}
              error={errors.pickupInstructions}
              hint="Horários, como chegar, o que trazer."
            />
          </fieldset>
        </fieldset>
        {canEdit && (
          <button type="submit" disabled={busy} className={PRIMARY}>
            Salvar entrega
          </button>
        )}
      </Form>
    </Section>
  );
}
