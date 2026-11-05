// /account — overview: e-mail verification reminder, latest orders, shortcuts. An account whose profile was never
// saved (its registration was interrupted) completes it here first.
import { useEffect } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { createCustomerProfile, getCustomerProfile, listCustomerOrders } from "~/.server/customers";
import { Checkbox, Field, focusFirstError } from "~/components/form";
import { Button, ButtonLink, Notice } from "~/components/ui";
import { fieldErrors, registrationFormToObject, registrationSchema } from "~/lib/account";
import { formatBRL } from "~/lib/money";
import { orderStatusLabel } from "~/lib/orders";

import type { Route } from "./+types/account.home";

export async function loader({ context }: Route.LoaderArgs) {
  const user = context.get(customerContext);
  const [profile, orders] = await Promise.all([getCustomerProfile(user.uid), listCustomerOrders(user)]);
  return data({ emailVerified: user.emailVerified, hasProfile: profile !== null, orders: orders.slice(0, 3), orderCount: orders.length }, { headers: ACCOUNT_HEADERS });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(customerContext);
  const parsed = registrationSchema.safeParse(registrationFormToObject(await request.formData()));
  if (!parsed.success) return data({ fieldErrors: fieldErrors(parsed.error) }, { status: 400, headers: ACCOUNT_HEADERS });
  await createCustomerProfile(user, parsed.data);
  return redirect("/account", { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "America/Sao_Paulo" });

export default function AccountHome({ loaderData, actionData }: Route.ComponentProps) {
  const { emailVerified, hasProfile, orders, orderCount } = loaderData;
  if (!hasProfile) return <CompleteProfile errors={actionData?.fieldErrors ?? {}} />;
  return (
    <div className="space-y-10">
      <h1 className="text-4xl">Minha conta</h1>
      {!emailVerified && (
        <Notice tone="warning">
          Confirme o seu e-mail pelo link que enviamos. Depois disso, os pedidos feitos sem login com este e-mail também aparecem aqui.{" "}
          <Link to="/account/security" className="underline underline-offset-4">
            Reenviar o e-mail de confirmação
          </Link>
        </Notice>
      )}
      <section aria-labelledby="ultimos">
        <div className="flex items-baseline justify-between gap-4">
          <h2 id="ultimos" className="text-2xl">
            Últimos pedidos
          </h2>
          {orderCount > 3 && (
            <Link to="/account/orders" className="text-sm underline underline-offset-4">
              Ver todos ({orderCount})
            </Link>
          )}
        </div>
        {orders.length === 0 ? (
          <div className="mt-4 space-y-4">
            <p className="text-muted">Você ainda não tem pedidos.</p>
            <ButtonLink to="/collections/all">Explorar produtos</ButtonLink>
          </div>
        ) : (
          <ul className="mt-4 divide-y divide-line border-y border-line">
            {orders.map((o) => (
              <li key={o.number}>
                <Link to={`/account/orders/${o.number}`} className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 py-4 hover:bg-surface">
                  <span className="font-medium">Pedido nº {o.number}</span>
                  <span className="text-sm text-muted">{date.format(new Date(o.createdAt))}</span>
                  <span className="text-sm">{orderStatusLabel(o.status, o.method)}</span>
                  <span className="text-sm">{formatBRL(o.totalCents)}</span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-labelledby="atalhos" className="grid gap-4 sm:grid-cols-3">
        <h2 id="atalhos" className="sr-only">
          Atalhos
        </h2>
        <Link to="/account/addresses" className="border border-line p-4 hover:border-ink">
          <span className="block font-medium">Endereços</span>
          <span className="text-sm text-muted">Salve endereços para comprar mais rápido.</span>
        </Link>
        <Link to="/wishlist" className="border border-line p-4 hover:border-ink">
          <span className="block font-medium">Lista de desejos</span>
          <span className="text-sm text-muted">Os produtos que você favoritou.</span>
        </Link>
        <Link to="/account/privacy" className="border border-line p-4 hover:border-ink">
          <span className="block font-medium">Privacidade e dados</span>
          <span className="text-sm text-muted">Baixe seus dados ou exclua a conta.</span>
        </Link>
      </section>
    </div>
  );
}

function CompleteProfile({ errors }: { errors: Record<string, string> }) {
  const navigation = useNavigation();
  useEffect(() => {
    if (Object.keys(errors).length > 0) focusFirstError();
  }, [errors]);
  return (
    <div className="max-w-xl space-y-6">
      <h1 className="text-4xl">Complete seu cadastro</h1>
      <p className="text-muted">Faltam alguns dados para concluir a criação da sua conta.</p>
      <Form method="post" noValidate className="space-y-4">
        <Field name="name" label="Nome completo" autoComplete="name" required error={errors.name} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="phone" label="Celular (WhatsApp)" type="tel" autoComplete="tel-national" placeholder="(21) 99999-9999" required error={errors.phone} />
          <Field name="cpf" label="CPF" inputMode="numeric" placeholder="000.000.000-00" required error={errors.cpf} hint="Necessário para emitir a nota fiscal dos pedidos." />
        </div>
        <Checkbox name="marketingEmail">Quero receber novidades e ofertas por e-mail (opcional).</Checkbox>
        <Checkbox name="acceptTerms" required error={errors.acceptTerms}>
          Li e aceito os{" "}
          <Link to="/terms" target="_blank" rel="noopener" className="underline underline-offset-4">
            termos de uso
          </Link>{" "}
          e a{" "}
          <Link to="/privacy" target="_blank" rel="noopener" className="underline underline-offset-4">
            política de privacidade
          </Link>
          .
        </Checkbox>
        <Button type="submit" disabled={navigation.state !== "idle"}>
          Salvar
        </Button>
      </Form>
    </div>
  );
}
