// /account/security — change the password (the current one typed again) and re-send the verification e-mail. Both
// happen in the browser with the Firebase SDK, in memory only; the session cookie can't do them.
//
// A password change makes Firebase revoke every session of the account, this browser's cookie included, so the new ID
// token goes to /login's action (outside the account gate, which would already refuse the old cookie): it sets a new
// cookie and comes back here with ?senha=trocada.
import { type FormEvent, useState } from "react";
import { data, useNavigation, useSearchParams, useSubmit } from "react-router";

import { changePassword, firebaseErrorCode, forgetSignIn, resendVerification } from "~/.client/firebase";
import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { firebaseWebConfig } from "~/.server/firebase";
import { Field } from "~/components/form";
import { Button, Notice } from "~/components/ui";
import { MIN_PASSWORD_LENGTH } from "~/lib/account";
import { authMessage } from "~/lib/auth-messages";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/account.security";

export function loader({ context }: Route.LoaderArgs) {
  const user = context.get(customerContext);
  return data({ firebase: firebaseWebConfig(), email: user.email, emailVerified: user.emailVerified }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

const value = (id: string) => (document.getElementById(id) as HTMLInputElement | null)?.value ?? "";

export default function AccountSecurity({ loaderData }: Route.ComponentProps) {
  const { firebase, email, emailVerified } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [params] = useSearchParams();
  const [pwState, setPwState] = useState<{ working: boolean; error: string | null; field?: string }>({ working: false, error: null });
  const [verify, setVerify] = useState<{ working: boolean; error: string | null; sent: boolean }>({ working: false, error: null, sent: false });

  const onChangePassword = async (event: FormEvent) => {
    event.preventDefault();
    const current = value("f-current");
    const next = value("f-new");
    if (next.length < MIN_PASSWORD_LENGTH) return setPwState({ working: false, error: `A nova senha precisa de pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`, field: "new" });
    if (next !== value("f-new2")) return setPwState({ working: false, error: "As senhas novas não são iguais.", field: "new2" });
    setPwState({ working: true, error: null });
    try {
      const idToken = await changePassword(firebase, email, current, next);
      await forgetSignIn();
      (event.target as HTMLFormElement).reset();
      setPwState({ working: false, error: null }); // the navigation below keeps the button disabled until it lands
      submit({ idToken, redirectTo: "/account/security?senha=trocada" }, { method: "post", action: "/login" });
    } catch (e) {
      await forgetSignIn();
      setPwState({ working: false, error: authMessage(firebaseErrorCode(e), "Não foi possível trocar a senha") });
    }
  };

  const onResend = async (event: FormEvent) => {
    event.preventDefault();
    setVerify({ working: true, error: null, sent: false });
    try {
      await resendVerification(firebase, email, value("f-verify-password"));
      await forgetSignIn();
      setVerify({ working: false, error: null, sent: true });
    } catch (e) {
      await forgetSignIn();
      setVerify({ working: false, error: authMessage(firebaseErrorCode(e), "Não foi possível enviar o e-mail"), sent: false });
    }
  };

  const changed = params.get("senha") === "trocada" && navigation.state === "idle";
  return (
    <div className="max-w-xl space-y-12">
      <h1 className="text-4xl">Senha e acesso</h1>

      <section aria-labelledby="senha" className="space-y-4">
        <h2 id="senha" className="text-2xl">
          Trocar a senha
        </h2>
        {changed && (
          <div role="status">
            <Notice tone="success">Senha trocada. Por segurança, as outras sessões abertas foram encerradas.</Notice>
          </div>
        )}
        {pwState.error && (
          <div role="alert">
            <Notice tone="danger">{pwState.error}</Notice>
          </div>
        )}
        <form onSubmit={onChangePassword} noValidate className="space-y-4">
          {/* No `name`s: passwords go to Firebase from the browser, never to our server. */}
          <Field name="" id="f-current" label="Senha atual" type="password" autoComplete="current-password" required />
          <Field name="" id="f-new" label="Nova senha" type="password" autoComplete="new-password" required hint={`Pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`} error={pwState.field === "new" ? " " : undefined} />
          <Field name="" id="f-new2" label="Repita a nova senha" type="password" autoComplete="new-password" required error={pwState.field === "new2" ? " " : undefined} />
          <Button type="submit" disabled={!hydrated || pwState.working || navigation.state !== "idle"}>
            {pwState.working ? "Trocando…" : "Trocar a senha"}
          </Button>
        </form>
      </section>

      <section aria-labelledby="email" className="space-y-4">
        <h2 id="email" className="text-2xl">
          E-mail
        </h2>
        {emailVerified ? (
          <p className="text-muted">
            O e-mail <strong className="text-ink">{email}</strong> está confirmado.
          </p>
        ) : (
          <>
            <p className="text-muted">
              O e-mail <strong className="text-ink">{email}</strong> ainda não foi confirmado. Confirmando, você passa a ver aqui os pedidos feitos sem login com
              este e-mail. Depois de clicar no link, saia e entre de novo para atualizar.
            </p>
            {verify.sent && (
              <div role="status">
                <Notice tone="success">Enviamos um novo link de confirmação. Confira também a caixa de spam.</Notice>
              </div>
            )}
            {verify.error && (
              <div role="alert">
                <Notice tone="danger">{verify.error}</Notice>
              </div>
            )}
            <form onSubmit={onResend} noValidate className="space-y-4">
              <Field name="" id="f-verify-password" label="Digite a sua senha para reenviar o link" type="password" autoComplete="current-password" required />
              <Button type="submit" variant="secondary" disabled={!hydrated || verify.working}>
                {verify.working ? "Enviando…" : "Reenviar e-mail de confirmação"}
              </Button>
            </form>
          </>
        )}
      </section>

      <section aria-labelledby="sessoes" className="space-y-2">
        <h2 id="sessoes" className="text-2xl">
          Sessões
        </h2>
        <p className="text-muted">Ao sair da conta, você sai em todos os aparelhos. A sessão dura até 14 dias.</p>
      </section>
    </div>
  );
}
