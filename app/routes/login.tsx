// /login — customer sign-in (docs/architecture.md §3). The browser signs in with the Firebase Auth JS SDK (memory
// only) and posts the fresh ID token here; the action sets the 14-day session cookie. Needs JavaScript; never cached,
// never indexed. Admin accounts (second factor) are told to use another e-mail to shop.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { data, Link, redirect, useNavigation, useSubmit } from "react-router";

import { firebaseErrorCode, forgetSignIn, signInWithPassword } from "~/.client/firebase";
import { ACCOUNT_HEADERS } from "~/.server/account-guard";
import { createCustomerSession, readCustomerSession } from "~/.server/customer-session";
import { firebaseWebConfig } from "~/.server/firebase";
import { Field } from "~/components/form";
import { Breadcrumbs, Button, Notice } from "~/components/ui";
import { safeAccountRedirect } from "~/lib/account";
import { authMessage } from "~/lib/auth-messages";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/login";

const EXPIRED = "O login demorou demais. Entre novamente.";

export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = safeAccountRedirect(new URL(request.url).searchParams.get("redirectTo"));
  if ((await readCustomerSession(request)).status === "ok") throw redirect(redirectTo, { headers: ACCOUNT_HEADERS });
  return data({ firebase: firebaseWebConfig(), redirectTo }, { headers: ACCOUNT_HEADERS });
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const idToken = form.get("idToken");
  if (typeof idToken !== "string" || !idToken) return data({ message: EXPIRED }, { status: 400, headers: ACCOUNT_HEADERS });
  const result = await createCustomerSession(idToken);
  if (!result.ok) return data({ message: EXPIRED }, { status: 401, headers: ACCOUNT_HEADERS });
  return redirect(safeAccountRedirect(form.get("redirectTo")), { headers: { ...ACCOUNT_HEADERS, "Set-Cookie": result.setCookie } });
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = () => [{ title: "Entrar | Loja Iyanifa" }, { name: "robots", content: "noindex, nofollow" }];

export default function Login({ loaderData, actionData }: Route.ComponentProps) {
  const { firebase, redirectTo } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = working || navigation.state !== "idle";

  // The SDK's sign-in is only needed until the server has answered.
  useEffect(() => {
    if (actionData) void forgetSignIn();
  }, [actionData]);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setWorking(true);
    try {
      const email = emailRef.current?.value.trim() ?? "";
      const result = await signInWithPassword(firebase, email, passwordRef.current?.value ?? "");
      if (result.kind !== "signed_in") {
        await forgetSignIn();
        setError(authMessage("app/second-factor-account"));
        return;
      }
      submit({ idToken: result.idToken, redirectTo }, { method: "post" });
    } catch (e) {
      setError(authMessage(firebaseErrorCode(e), "Não foi possível entrar"));
    } finally {
      setWorking(false);
    }
  };

  const message = error ?? actionData?.message ?? null;
  return (
    <div className="mx-auto max-w-md px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Entrar", href: "/login" }]} />
      <h1 className="mt-8 text-4xl">Entrar</h1>
      <p className="mt-3 text-muted">Acompanhe seus pedidos, salve endereços e favoritos.</p>
      {redirectTo === "/checkout" && <p className="mt-3 text-sm text-muted">Depois de entrar, você volta para a finalização da compra.</p>}
      <form method="post" onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
        {message && (
          <div role="alert">
            <Notice tone="danger">{message}</Notice>
          </div>
        )}
        <Field ref={emailRef} name="email" label="E-mail" type="email" autoComplete="email" required />
        {/* No `name`: the password never reaches our server, even if the form were submitted before the page loads. */}
        <Field ref={passwordRef} name="" id="f-password" label="Senha" type="password" autoComplete="current-password" required />
        <Button type="submit" className="w-full" disabled={!hydrated || busy}>
          {busy ? "Entrando…" : "Entrar"}
        </Button>
        {!hydrated && <p className="text-sm text-muted">Carregando… (o login precisa de JavaScript)</p>}
      </form>
      <div className="mt-6 space-y-2 text-sm">
        <p>
          <Link to="/forgot-password" className="underline underline-offset-4">
            Esqueci minha senha
          </Link>
        </p>
        <p>
          Ainda não tem conta?{" "}
          <Link to={`/register?redirectTo=${encodeURIComponent(redirectTo)}`} className="underline underline-offset-4">
            Criar conta
          </Link>
        </p>
        <p className="text-muted">Você também pode comprar sem conta.</p>
      </div>
    </div>
  );
}
