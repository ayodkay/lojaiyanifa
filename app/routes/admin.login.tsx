// /admin/login — sign-in for the store's team (docs/architecture.md §3).
// The browser signs in with the Firebase Auth JS SDK (kept in memory only) and
// posts the fresh ID token to the action, which checks role, verified e-mail
// and, in production, the second factor, then sets the session cookie
// (app/.server/session.ts). Needs JavaScript; never cached, never indexed.
import { type FormEvent, useEffect, useRef, useState } from "react";
import { data, redirect, useNavigation, useSubmit } from "react-router";

import { firebaseErrorCode, forgetSignIn, sendPasswordReset, sendVerificationEmail, signInForIdToken } from "~/.client/firebase";
import { ADMIN_HEADERS, REFUSAL_MESSAGE } from "~/.server/admin-guard";
import { firebaseWebConfig } from "~/.server/firebase";
import { createAdminSession, readAdminSession, type SignInResult } from "~/.server/session";
import { Button, Notice } from "~/components/ui";
import { adminMeta } from "~/lib/admin/meta";
import { safeAdminRedirect } from "~/lib/admin/redirect";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/admin.login";

type Refusal = Extract<SignInResult, { ok: false }>["reason"];

const EXPIRED = "O login expirou. Entre novamente.";
const SERVER_MESSAGE: Record<Refusal, string> = { ...REFUSAL_MESSAGE, invalid_token: EXPIRED, stale_sign_in: EXPIRED };

export async function loader({ request }: Route.LoaderArgs) {
  const redirectTo = safeAdminRedirect(new URL(request.url).searchParams.get("redirectTo"));
  const session = await readAdminSession(request);
  if (session.status === "ok") throw redirect(redirectTo, { headers: ADMIN_HEADERS });
  return data(
    { firebase: firebaseWebConfig(), redirectTo, notice: session.status === "forbidden" ? REFUSAL_MESSAGE[session.reason] : null },
    { headers: ADMIN_HEADERS },
  );
}

export async function action({ request }: Route.ActionArgs) {
  const form = await request.formData();
  const idToken = form.get("idToken");
  if (typeof idToken !== "string" || idToken === "") {
    return data({ reason: "invalid_token" as Refusal, message: EXPIRED }, { status: 400, headers: ADMIN_HEADERS });
  }
  const result = await createAdminSession(idToken);
  if (!result.ok) {
    const status = result.reason === "invalid_token" || result.reason === "stale_sign_in" ? 401 : 403;
    return data({ reason: result.reason, message: SERVER_MESSAGE[result.reason] }, { status, headers: ADMIN_HEADERS });
  }
  return redirect(safeAdminRedirect(form.get("redirectTo")), { headers: { ...ADMIN_HEADERS, "Set-Cookie": result.setCookie } });
}

export const headers = () => ADMIN_HEADERS;

export const meta = () => adminMeta("Entrar");

const WRONG_CREDENTIALS = "E-mail ou senha incorretos.";
const CLIENT_MESSAGE: Record<string, string> = {
  "auth/invalid-credential": WRONG_CREDENTIALS,
  "auth/invalid-email": WRONG_CREDENTIALS,
  "auth/user-not-found": WRONG_CREDENTIALS,
  "auth/wrong-password": WRONG_CREDENTIALS,
  "auth/missing-password": "Informe a sua senha.",
  "auth/user-disabled": "Esta conta está desativada.",
  "auth/too-many-requests": "Muitas tentativas seguidas. Aguarde alguns minutos ou crie uma nova senha.",
  "auth/network-request-failed": "Sem conexão com o serviço de login. Verifique a internet e tente novamente.",
  "auth/multi-factor-auth-required": "Esta conta usa verificação em duas etapas, que este painel ainda não oferece. Fale com o responsável técnico.",
};
const clientMessage = (code: string | null) => (code && CLIENT_MESSAGE[code]) || `Não foi possível entrar${code ? ` (${code})` : ""}. Tente novamente.`;

export default function AdminLogin({ loaderData, actionData }: Route.ComponentProps) {
  const { firebase, redirectTo, notice } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const busy = signingIn || navigation.state !== "idle";

  // The browser keeps its Firebase sign-in only until the server has answered,
  // except when the server asks for e-mail verification (that needs it).
  useEffect(() => {
    if (actionData && actionData.reason !== "email_unverified") void forgetSignIn();
  }, [actionData]);
  useEffect(() => () => void forgetSignIn(), []);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSigningIn(true);
    setError(null);
    setInfo(null);
    try {
      const idToken = await signInForIdToken(firebase, emailRef.current!.value.trim(), passwordRef.current!.value);
      await submit({ idToken, redirectTo }, { method: "post" });
    } catch (err) {
      setError(clientMessage(firebaseErrorCode(err)));
      passwordRef.current?.focus();
    } finally {
      setSigningIn(false);
    }
  }

  async function sendVerification() {
    setError(null);
    try {
      await sendVerificationEmail(firebase);
      await forgetSignIn();
      setInfo("Enviamos um link de confirmação para o seu e-mail. Depois de confirmar, entre novamente.");
    } catch (err) {
      setError(clientMessage(firebaseErrorCode(err)));
    }
  }

  async function resetPassword() {
    const email = emailRef.current;
    setError(null);
    setInfo(null);
    if (!email || !email.value.trim() || !email.checkValidity()) {
      setError("Informe o seu e-mail no campo acima para receber o link.");
      email?.focus();
      return;
    }
    try {
      await sendPasswordReset(firebase, email.value.trim());
    } catch (err) {
      // Never reveal whether an account exists.
      if (firebaseErrorCode(err) !== "auth/user-not-found") {
        setError(clientMessage(firebaseErrorCode(err)));
        return;
      }
    }
    setInfo("Se existir uma conta com esse e-mail, enviamos um link para criar uma nova senha.");
  }

  const serverMessage = actionData && !busy ? actionData.message : null;

  return (
    <main id="conteudo" className="grid min-h-dvh place-items-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm space-y-6 border border-line bg-surface p-6 md:p-8">
        <div>
          <p className="eyebrow">Loja Iyanifa</p>
          <h1 className="mt-2 text-3xl">Entrar no painel</h1>
        </div>

        <noscript>
          <Notice tone="warning">Para entrar no painel, ative o JavaScript neste navegador.</Notice>
        </noscript>
        {notice && !actionData && <Notice tone="warning">{notice}</Notice>}
        {serverMessage && <Notice tone={actionData?.reason === "email_unverified" ? "warning" : "danger"}>{serverMessage}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}

        {actionData?.reason === "email_unverified" && !info && (
          <Button variant="secondary" className="w-full" onClick={sendVerification}>
            Enviar link de confirmação
          </Button>
        )}

        {/* method="post" and no name on the password: a submit before JavaScript loads can never put the password in a URL. */}
        <form method="post" onSubmit={onSubmit} className="space-y-4">
          <div>
            <label htmlFor="email" className="mb-1 block text-sm">
              E-mail
            </label>
            <input
              ref={emailRef}
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              className="min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3"
            />
          </div>
          <div>
            <label htmlFor="password" className="mb-1 block text-sm">
              Senha
            </label>
            <input
              ref={passwordRef}
              id="password"
              type="password"
              autoComplete="current-password"
              required
              className="min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3"
            />
          </div>
          <Button type="submit" className="w-full" disabled={!hydrated || busy}>
            {busy ? "Entrando…" : "Entrar"}
          </Button>
        </form>

        <Button variant="ghost" className="text-sm" onClick={resetPassword} disabled={!hydrated || busy}>
          Esqueci minha senha
        </Button>
      </div>
    </main>
  );
}
