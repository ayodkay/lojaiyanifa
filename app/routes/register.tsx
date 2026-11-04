// /register — create a customer account. The form is checked in the browser with the server's own schema BEFORE the
// Firebase sign-in is created (so a typo can't leave a half-made account), then the browser creates the sign-in, sends
// the verification e-mail and posts the fresh ID token with the profile; the action checks everything again, saves the
// profile and consents (app/.server/customers.ts) and sets the session cookie. Owner decision: CPF required.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { data, Link, redirect, useNavigation, useSubmit } from "react-router";

import { createAccount, firebaseErrorCode, forgetSignIn } from "~/.client/firebase";
import { ACCOUNT_HEADERS } from "~/.server/account-guard";
import { createCustomerSession, readCustomerSession } from "~/.server/customer-session";
import { createCustomerProfile } from "~/.server/customers";
import { firebaseWebConfig } from "~/.server/firebase";
import { Checkbox, Field } from "~/components/form";
import { Breadcrumbs, Button, Notice } from "~/components/ui";
import { fieldErrors, MIN_PASSWORD_LENGTH, registrationFormToObject, registrationSchema, safeAccountRedirect } from "~/lib/account";
import { authMessage } from "~/lib/auth-messages";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/register";

const EXPIRED = "A criação da conta demorou demais. Entre com o e-mail e a senha que você escolheu.";

export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = safeAccountRedirect(new URL(request.url).searchParams.get("redirectTo"));
  if ((await readCustomerSession(request)).status === "ok") throw redirect(redirectTo, { headers: ACCOUNT_HEADERS });
  return data({ firebase: firebaseWebConfig(), redirectTo }, { headers: ACCOUNT_HEADERS });
}

interface ActionResult {
  message?: string;
  fieldErrors?: Record<string, string>;
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const idToken = form.get("idToken");
  if (typeof idToken !== "string" || !idToken) return data<ActionResult>({ message: EXPIRED }, { status: 400, headers: ACCOUNT_HEADERS });
  const session = await createCustomerSession(idToken);
  if (!session.ok) return data<ActionResult>({ message: EXPIRED }, { status: 401, headers: ACCOUNT_HEADERS });
  const parsed = registrationSchema.safeParse(registrationFormToObject(form));
  const headers = { ...ACCOUNT_HEADERS, "Set-Cookie": session.setCookie };
  // The sign-in exists by now: keep the customer signed in either way. With a bad form (the browser checked it, so
  // only a crafted request gets here) the account page asks for the missing details.
  if (!parsed.success) return redirect("/account", { headers });
  await createCustomerProfile(session.user, parsed.data);
  return redirect(safeAccountRedirect(form.get("redirectTo")), { headers });
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = () => [{ title: "Criar conta | Loja Iyanifa" }, { name: "robots", content: "noindex, nofollow" }];

export default function Register({ loaderData, actionData }: Route.ComponentProps) {
  const { firebase, redirectTo } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const formRef = useRef<HTMLFormElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const busy = working || navigation.state !== "idle";

  useEffect(() => {
    if (actionData) void forgetSignIn();
  }, [actionData]);

  useEffect(() => {
    if (Object.keys(errors).length > 0) document.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [errors]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    const form = new FormData(formRef.current!);
    const email = String(form.get("email") ?? "").trim().toLowerCase();
    const password = (document.getElementById("f-password") as HTMLInputElement).value;
    const confirm = (document.getElementById("f-password2") as HTMLInputElement).value;

    const parsed = registrationSchema.safeParse(registrationFormToObject(form));
    const next: Record<string, string> = parsed.success ? {} : fieldErrors(parsed.error);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) next.email = "E-mail inválido.";
    if (password.length < MIN_PASSWORD_LENGTH) next.password = `Use pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`;
    else if (password !== confirm) next.password2 = "As senhas não são iguais.";
    setErrors(next);
    if (Object.keys(next).length > 0 || !parsed.success) return;

    setWorking(true);
    try {
      const account = await createAccount(firebase, email, password);
      if (!account.verificationSent) console.warn("[register] verification e-mail not sent; the account page offers to resend it");
      form.delete("email");
      form.set("idToken", account.idToken);
      form.set("redirectTo", redirectTo);
      submit(form, { method: "post" });
    } catch (e) {
      setError(authMessage(firebaseErrorCode(e), "Não foi possível criar a conta"));
    } finally {
      setWorking(false);
    }
  };

  const message = error ?? actionData?.message ?? null;
  return (
    <div className="mx-auto max-w-xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Criar conta", href: "/register" }]} />
      <h1 className="mt-8 text-4xl">Criar conta</h1>
      <p className="mt-3 text-muted">Com a conta, você acompanha seus pedidos em um só lugar e compra mais rápido.</p>
      <form ref={formRef} method="post" onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {message && (
          <div role="alert">
            <Notice tone="danger">{message}</Notice>
          </div>
        )}
        <Field name="name" label="Nome completo" autoComplete="name" required error={errors.name} />
        <Field name="email" label="E-mail" type="email" autoComplete="email" required error={errors.email} />
        <div className="grid gap-4 sm:grid-cols-2">
          <Field name="phone" label="Celular (WhatsApp)" type="tel" autoComplete="tel-national" placeholder="(21) 99999-9999" required error={errors.phone} />
          <Field name="cpf" label="CPF" inputMode="numeric" placeholder="000.000.000-00" required error={errors.cpf} hint="Necessário para emitir a nota fiscal dos pedidos." />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {/* No `name`: passwords go to Firebase from the browser, never to our server. */}
          <Field name="" id="f-password" label="Senha" type="password" autoComplete="new-password" required error={errors.password} hint={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`} />
          <Field name="" id="f-password2" label="Repita a senha" type="password" autoComplete="new-password" required error={errors.password2} />
        </div>
        <Checkbox name="marketingEmail">Quero receber novidades e ofertas por e-mail (opcional; você pode cancelar quando quiser).</Checkbox>
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
        <Button type="submit" className="w-full" disabled={!hydrated || busy}>
          {busy ? "Criando a conta…" : "Criar conta"}
        </Button>
        {!hydrated && <p className="text-sm text-muted">Carregando… (o cadastro precisa de JavaScript)</p>}
      </form>
      <p className="mt-6 text-sm">
        Já tem conta?{" "}
        <Link to={`/login?redirectTo=${encodeURIComponent(redirectTo)}`} className="underline underline-offset-4">
          Entrar
        </Link>
      </p>
    </div>
  );
}
