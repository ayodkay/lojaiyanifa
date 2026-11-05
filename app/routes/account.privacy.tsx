// /account/privacy — the customer's LGPD tools: download a copy of their data (art. 18, II and V), change the
// marketing consent (on the profile page), and delete the account (art. 18, VI) after typing the password again.
// Orders are kept after a deletion, as the law requires; the page says so before anything happens.
import { type FormEvent, useState } from "react";
import { data, Link, redirect, useNavigation, useSubmit } from "react-router";

import { confirmPassword, firebaseErrorCode, forgetSignIn } from "~/.client/firebase";
import { ACCOUNT_HEADERS, customerContext } from "~/.server/account-guard";
import { verifyRecentSignIn } from "~/.server/customer-session";
import { deleteCustomerAccount } from "~/.server/customers";
import { firebaseWebConfig } from "~/.server/firebase";
import { expiredSessionCookie } from "~/.server/session";
import { Checkbox, Field } from "~/components/form";
import { Button, Notice } from "~/components/ui";
import { authMessage } from "~/lib/auth-messages";
import { useHydrated } from "~/lib/use-hydrated";

import type { Route } from "./+types/account.privacy";

export function loader({ context }: Route.LoaderArgs) {
  return data({ firebase: firebaseWebConfig(), email: context.get(customerContext).email }, { headers: ACCOUNT_HEADERS });
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(customerContext);
  const form = await request.formData();
  const idToken = form.get("idToken");
  if (form.get("intent") !== "delete" || form.get("confirm") !== "on" || typeof idToken !== "string") {
    return data({ message: "Confirme a exclusão marcando a caixa e digitando a sua senha." }, { status: 400, headers: ACCOUNT_HEADERS });
  }
  if (!(await verifyRecentSignIn(idToken, user.uid))) {
    return data({ message: "A confirmação da senha expirou. Digite a senha de novo." }, { status: 401, headers: ACCOUNT_HEADERS });
  }
  await deleteCustomerAccount(user);
  return redirect("/?conta=excluida", { headers: { ...ACCOUNT_HEADERS, "Set-Cookie": expiredSessionCookie() } });
}

export const headers = () => ACCOUNT_HEADERS;

export default function AccountPrivacy({ loaderData, actionData }: Route.ComponentProps) {
  const { firebase, email } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const [confirmed, setConfirmed] = useState(false);
  const [state, setState] = useState<{ working: boolean; error: string | null }>({ working: false, error: null });

  const onDelete = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirmed) return setState({ working: false, error: "Marque a caixa para confirmar a exclusão." });
    setState({ working: true, error: null });
    try {
      const idToken = await confirmPassword(firebase, email, (document.getElementById("f-delete-password") as HTMLInputElement).value);
      await forgetSignIn();
      submit({ intent: "delete", confirm: "on", idToken }, { method: "post" });
    } catch (e) {
      await forgetSignIn();
      setState({ working: false, error: authMessage(firebaseErrorCode(e), "Não foi possível confirmar a senha") });
    }
  };

  const error = state.error ?? actionData?.message ?? null;
  return (
    <div className="max-w-xl space-y-12">
      <h1 className="text-4xl">Privacidade e dados</h1>

      <section aria-labelledby="copia" className="space-y-3">
        <h2 id="copia" className="text-2xl">
          Baixar os meus dados
        </h2>
        <p className="text-muted">Um arquivo (JSON) com o seu cadastro, consentimentos, endereços, lista de desejos e pedidos.</p>
        {/* A document download, not a client-side navigation. */}
        <a href="/account/export" download className="inline-flex rounded-[var(--radius-control)] border border-ink px-6 py-3 text-sm font-medium hover:bg-ink hover:text-paper">
          Baixar os meus dados
        </a>
      </section>

      <section aria-labelledby="consentimentos" className="space-y-3">
        <h2 id="consentimentos" className="text-2xl">
          Consentimentos
        </h2>
        <p className="text-muted">
          Você escolhe se quer receber novidades e ofertas por e-mail em{" "}
          <Link to="/account/profile" className="text-ink underline underline-offset-4">
            Dados pessoais
          </Link>
          . Saiba como tratamos os seus dados na{" "}
          <Link to="/privacy" className="text-ink underline underline-offset-4">
            Política de Privacidade
          </Link>{" "}
          e na{" "}
          <Link to="/cookies" className="text-ink underline underline-offset-4">
            Política de Cookies
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="excluir" className="space-y-4">
        <h2 id="excluir" className="text-2xl">
          Excluir a conta
        </h2>
        <p className="text-muted">
          Apagamos o seu cadastro, endereços, lista de desejos e preferências, e o seu login deixa de existir. Os pedidos já feitos continuam guardados pelo
          prazo exigido pelas leis fiscais e de defesa do consumidor. Esta ação não pode ser desfeita.
        </p>
        {error && (
          <div role="alert">
            <Notice tone="danger">{error}</Notice>
          </div>
        )}
        <form onSubmit={onDelete} noValidate className="space-y-4">
          <Checkbox name="confirm" checked={confirmed} onChange={(e) => setConfirmed(e.currentTarget.checked)}>
            Entendo que a exclusão é definitiva.
          </Checkbox>
          {/* No `name`: the password goes to Firebase from the browser, never to our server. */}
          <Field name="" id="f-delete-password" label="Digite a sua senha para confirmar" type="password" autoComplete="current-password" required />
          <Button type="submit" variant="secondary" className="border-danger text-danger hover:bg-danger hover:text-paper" disabled={!hydrated || state.working || navigation.state !== "idle"}>
            {state.working || navigation.state !== "idle" ? "Excluindo…" : "Excluir a minha conta"}
          </Button>
        </form>
      </section>
    </div>
  );
}
