// /forgot-password — Firebase sends the reset e-mail from the browser (sendPasswordResetEmail, in Portuguese). The page
// says the same thing whether or not the address has an account, so it can't be used to find out who is a customer.
import { type FormEvent, useRef, useState } from "react";
import { data, Link } from "react-router";

import { firebaseErrorCode, sendPasswordReset } from "~/.client/firebase";
import { ACCOUNT_HEADERS } from "~/.server/account-guard";
import { firebaseWebConfig } from "~/.server/firebase";
import { Field } from "~/components/form";
import { Breadcrumbs, Button, Notice } from "~/components/ui";
import { authMessage } from "~/lib/auth-messages";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/forgot-password";

export function loader() {
  return data({ firebase: firebaseWebConfig() }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = () => [{ title: "Criar nova senha | Loja Iyanifa" }, { name: "robots", content: "noindex, nofollow" }];

/** Codes that say nothing about whether the account exists: shown as the generic success. */
const SAME_AS_SUCCESS = new Set(["auth/user-not-found", "auth/user-disabled"]);

export default function ForgotPassword({ loaderData }: Route.ComponentProps) {
  const hydrated = useHydrated();
  const emailRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent">("idle");
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setState("sending");
    try {
      await sendPasswordReset(loaderData.firebase, emailRef.current?.value.trim() ?? "");
      setState("sent");
    } catch (e) {
      const code = firebaseErrorCode(e);
      if (code && SAME_AS_SUCCESS.has(code)) {
        setState("sent");
        return;
      }
      setError(authMessage(code, "Não foi possível enviar o e-mail"));
      setState("idle");
    }
  };

  return (
    <div className="mx-auto max-w-md px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Entrar", href: "/login" }, { name: "Nova senha", href: "/forgot-password" }]} />
      <h1 className="mt-8 text-4xl">Criar nova senha</h1>
      {state === "sent" ? (
        <div className="mt-8 space-y-4" role="status">
          <Notice tone="success">Se houver uma conta com este e-mail, você vai receber em instantes um link para criar uma nova senha. Confira também a caixa de spam.</Notice>
          <Link to="/login" className="inline-block underline underline-offset-4">
            Voltar para o login
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} noValidate className="mt-8 space-y-4">
          <p className="text-muted">Informe o e-mail da sua conta. Enviaremos um link para você criar uma nova senha.</p>
          {error && (
            <div role="alert">
              <Notice tone="danger">{error}</Notice>
            </div>
          )}
          <Field ref={emailRef} name="email" label="E-mail" type="email" autoComplete="email" required />
          <Button type="submit" className="w-full" disabled={!hydrated || state === "sending"}>
            {state === "sending" ? "Enviando…" : "Enviar link"}
          </Button>
        </form>
      )}
    </div>
  );
}
