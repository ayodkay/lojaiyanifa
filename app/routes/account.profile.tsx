// /account/profile — name, mobile, CPF and the marketing e-mail consent. The e-mail is the sign-in: changing it goes
// through support (it would also change which guest orders the account sees).
import { useEffect } from "react";
import { data, Form, redirect, useNavigation } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { getCustomerProfile, updateCustomerProfile } from "~/.server/customers";
import { Checkbox, Field, focusFirstError } from "~/components/form";
import { Button, Notice } from "~/components/ui";
import { fieldErrors, profileFormToObject, profileSchema } from "~/lib/account";
import { formatBrPhone, formatCpf } from "~/lib/br";

import type { Route } from "./+types/account.profile";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(customerContext);
  const profile = await getCustomerProfile(user.uid);
  if (!profile) throw redirect("/account", { headers: ACCOUNT_HEADERS });
  return data({ profile, email: user.email }, { headers: ACCOUNT_HEADERS });
}

export async function action({ request, context }: Route.ActionArgs) {
  const parsed = profileSchema.safeParse(profileFormToObject(await request.formData()));
  if (!parsed.success) return data({ fieldErrors: fieldErrors(parsed.error), saved: false }, { status: 400, headers: ACCOUNT_HEADERS });
  await updateCustomerProfile(context.get(customerContext), parsed.data);
  return data({ fieldErrors: {} as Record<string, string>, saved: true }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

export default function AccountProfile({ loaderData, actionData }: Route.ComponentProps) {
  const { profile, email } = loaderData;
  const errors = actionData?.fieldErrors ?? {};
  const navigation = useNavigation();
  useEffect(() => {
    if (actionData && !actionData.saved) focusFirstError();
  }, [actionData]);
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-4xl">Dados pessoais</h1>
      {actionData?.saved && (
        <div role="status">
          <Notice tone="success">Dados salvos.</Notice>
        </div>
      )}
      <Form method="post" noValidate className="space-y-4">
        <Field name="name" label="Nome completo" autoComplete="name" required defaultValue={profile.name} error={errors.name} />
        <div>
          <p className="mb-1 block text-sm">E-mail</p>
          <p className="min-h-11 break-all py-2.5 text-ink-soft">{email}</p>
          <p className="text-xs text-muted">Para trocar o e-mail da conta, fale com a gente pelo atendimento.</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="phone" label="Celular (WhatsApp)" type="tel" autoComplete="tel-national" required defaultValue={formatBrPhone(profile.phone)} error={errors.phone} />
          <Field name="cpf" label="CPF" inputMode="numeric" required defaultValue={formatCpf(profile.cpf)} error={errors.cpf} hint="Necessário para emitir a nota fiscal dos pedidos." />
        </div>
        <Checkbox name="marketingEmail" defaultChecked={profile.marketingEmail}>
          Quero receber novidades e ofertas por e-mail. Você pode mudar isso quando quiser; os e-mails sobre os seus pedidos continuam chegando.
        </Checkbox>
        <Button type="submit" disabled={navigation.state !== "idle"}>
          {navigation.state === "submitting" ? "Salvando…" : "Salvar"}
        </Button>
      </Form>
    </div>
  );
}
