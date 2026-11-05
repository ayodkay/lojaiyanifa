// /account/addresses — saved delivery addresses (max 10): add, edit, delete, choose the default. The checkout offers
// them when the customer is signed in. The CEP fills the street through ViaCEP, as at checkout.
import { useEffect, useState } from "react";
import { data, Form, useNavigation } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { AddressLimitError, deleteAddress, listAddresses, type SavedAddress, saveAddress } from "~/.server/customers";
import { Checkbox, Field, focusFirstError, INPUT_CLASS } from "~/components/form";
import { Button, cx, Notice } from "~/components/ui";
import { addressFormToObject, fieldErrors, MAX_ADDRESSES, savedAddressSchema } from "~/lib/account";
import { formatCep, normalizeCep, UFS } from "~/lib/br";

import type { Route } from "./+types/account.addresses";

export async function loader({ context }: Route.LoaderArgs) {
  return data({ addresses: await listAddresses(context.get(customerContext).uid) }, { headers: ACCOUNT_HEADERS });
}

interface ActionResult {
  /** Which form the answer is for: an address id, or "new". */
  form: string;
  fieldErrors?: Record<string, string>;
  message?: string;
  saved?: boolean;
}

export async function action({ request, context }: Route.ActionArgs) {
  const { uid } = context.get(customerContext);
  const form = await request.formData();
  const intent = form.get("intent");
  const id = typeof form.get("id") === "string" && form.get("id") ? String(form.get("id")) : null;
  if (intent === "delete" && id) {
    await deleteAddress(uid, id);
    return data<ActionResult>({ form: id, saved: true }, { headers: ACCOUNT_HEADERS });
  }
  const parsed = savedAddressSchema.safeParse(addressFormToObject(form));
  if (!parsed.success) return data<ActionResult>({ form: id ?? "new", fieldErrors: fieldErrors(parsed.error) }, { status: 400, headers: ACCOUNT_HEADERS });
  try {
    await saveAddress(uid, id, parsed.data);
  } catch (error) {
    if (error instanceof AddressLimitError) {
      return data<ActionResult>({ form: "new", message: `Você já tem ${MAX_ADDRESSES} endereços salvos. Exclua um para adicionar outro.` }, { status: 409, headers: ACCOUNT_HEADERS });
    }
    throw error;
  }
  return data<ActionResult>({ form: id ?? "new", saved: true }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const oneLine = (a: SavedAddress) =>
  `${a.street}, ${a.number}${a.complement ? ` — ${a.complement}` : ""} · ${a.neighborhood}, ${a.city} – ${a.state} · CEP ${formatCep(a.cep)}`;

export default function AccountAddresses({ loaderData, actionData }: Route.ComponentProps) {
  const { addresses } = loaderData;
  const [editing, setEditing] = useState<string | null>(addresses.length === 0 ? "new" : null);
  const navigation = useNavigation();

  // After a successful save, close the form; after a rejected one, keep it open on the first error.
  useEffect(() => {
    if (!actionData) return;
    if (actionData.saved) {
      setEditing(null);
      // The form may have been far down the page: bring the confirmation into view.
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else {
      setEditing(actionData.form);
      focusFirstError();
    }
  }, [actionData]);

  return (
    <div className="space-y-6">
      <h1 className="text-4xl">Endereços</h1>
      {actionData?.saved && !editing && (
        <div role="status">
          <Notice tone="success">Endereços atualizados.</Notice>
        </div>
      )}
      {addresses.length > 0 && (
        <ul className="space-y-4">
          {addresses.map((a) => (
            <li key={a.id} className="border border-line p-4">
              {editing === a.id ? (
                <AddressForm address={a} result={actionData?.form === a.id ? actionData : undefined} onCancel={() => setEditing(null)} />
              ) : (
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="font-medium">
                      {a.label ?? "Endereço"}
                      {a.isDefault && <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-ink-soft">Padrão</span>}
                    </p>
                    <p className="mt-1 text-sm text-muted">{oneLine(a)}</p>
                  </div>
                  <div className="flex flex-wrap gap-3 text-sm">
                    <button type="button" className="underline underline-offset-4" onClick={() => setEditing(a.id)}>
                      Editar
                    </button>
                    <Form method="post">
                      <input type="hidden" name="intent" value="delete" />
                      <input type="hidden" name="id" value={a.id} />
                      <button type="submit" className="text-danger underline underline-offset-4" disabled={navigation.state !== "idle"}>
                        Excluir
                      </button>
                    </Form>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editing === "new" ? (
        <div className="border border-line p-4">
          <h2 className="mb-4 text-xl">Novo endereço</h2>
          <AddressForm result={actionData?.form === "new" ? actionData : undefined} onCancel={addresses.length > 0 ? () => setEditing(null) : undefined} />
        </div>
      ) : (
        addresses.length < MAX_ADDRESSES && (
          <Button variant="secondary" onClick={() => setEditing("new")}>
            Adicionar endereço
          </Button>
        )
      )}
    </div>
  );
}

type CepStatus = "idle" | "loading" | "found" | "not_found" | "error";
const CEP_HINT: Record<CepStatus, string> = {
  idle: "Preenchemos o endereço a partir do CEP.",
  loading: "Buscando endereço…",
  found: "Endereço encontrado. Confira e informe o número.",
  not_found: "CEP não encontrado. Preencha o endereço manualmente.",
  error: "Não foi possível buscar o CEP agora. Preencha o endereço manualmente.",
};

function AddressForm({ address, result, onCancel }: { address?: SavedAddress; result?: ActionResult; onCancel?: () => void }) {
  const navigation = useNavigation();
  const errors = result?.fieldErrors ?? {};
  const [fields, setFields] = useState({
    cep: address ? formatCep(address.cep) : "",
    street: address?.street ?? "",
    number: address?.number ?? "",
    complement: address?.complement ?? "",
    neighborhood: address?.neighborhood ?? "",
    city: address?.city ?? "",
    state: address?.state ?? "",
    label: address?.label ?? "",
  });
  const [cepStatus, setCepStatus] = useState<CepStatus>("idle");
  const set = (name: keyof typeof fields) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setFields((f) => ({ ...f, [name]: e.target.value }));

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
      setFields((f) => ({ ...f, cep: formatCep(cep), street: found.logradouro || f.street, neighborhood: found.bairro || f.neighborhood, city: found.localidade || f.city, state: found.uf || f.state }));
      setCepStatus("found");
    } catch (error) {
      console.warn("[addresses] ViaCEP lookup failed", error);
      setCepStatus("error");
    }
  };

  return (
    <Form method="post" noValidate className="space-y-4">
      {address && <input type="hidden" name="id" value={address.id} />}
      {result?.message && (
        <div data-form-error tabIndex={-1} className="outline-none">
          <Notice tone="danger">{result.message}</Notice>
        </div>
      )}
      <Field name="label" label="Nome do endereço (opcional)" placeholder="Casa, Trabalho…" value={fields.label} onChange={set("label")} error={errors.label} className="sm:max-w-xs" />
      <Field
        name="cep"
        id={`f-cep-${address?.id ?? "new"}`}
        label="CEP"
        inputMode="numeric"
        autoComplete="postal-code"
        placeholder="00000-000"
        required
        value={fields.cep}
        onChange={(e) => {
          set("cep")(e);
          if (normalizeCep(e.target.value)) void lookupCep(e.target.value);
        }}
        error={errors.cep}
        hint={<span aria-live="polite">{CEP_HINT[cepStatus]}</span>}
        className="sm:max-w-xs"
      />
      <Field name="street" label="Rua" autoComplete="address-line1" required value={fields.street} onChange={set("street")} error={errors.street} />
      <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
        <Field name="number" label="Número" required value={fields.number} onChange={set("number")} error={errors.number} />
        <Field name="complement" label="Complemento (opcional)" autoComplete="address-line2" value={fields.complement} onChange={set("complement")} error={errors.complement} />
      </div>
      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_8rem]">
        <Field name="neighborhood" label="Bairro" required value={fields.neighborhood} onChange={set("neighborhood")} error={errors.neighborhood} />
        <Field name="city" label="Cidade" autoComplete="address-level2" required value={fields.city} onChange={set("city")} error={errors.city} />
        <div>
          <label htmlFor={`f-state-${address?.id ?? "new"}`} className="mb-1 block text-sm">
            Estado
          </label>
          <select
            id={`f-state-${address?.id ?? "new"}`}
            name="state"
            required
            autoComplete="address-level1"
            value={fields.state}
            onChange={set("state")}
            aria-invalid={errors.state ? true : undefined}
            className={cx(INPUT_CLASS, errors.state ? "border-danger" : "border-line-strong")}
          >
            <option value="">UF</option>
            {UFS.map((uf) => (
              <option key={uf} value={uf}>
                {uf}
              </option>
            ))}
          </select>
          {errors.state && <p className="mt-1 text-sm text-danger">{errors.state}</p>}
        </div>
      </div>
      <Checkbox name="isDefault" defaultChecked={address?.isDefault ?? false}>
        Usar como endereço padrão
      </Checkbox>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={navigation.state !== "idle"}>
          Salvar endereço
        </Button>
        {onCancel && (
          <Button variant="secondary" onClick={onCancel}>
            Cancelar
          </Button>
        )}
      </div>
    </Form>
  );
}
