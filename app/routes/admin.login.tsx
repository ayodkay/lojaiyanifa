// /admin/login — sign-in for the store's team (docs/architecture.md §3).
// The browser signs in with the Firebase Auth JS SDK (kept in memory only) and
// posts the fresh ID token to the action, which checks role, verified e-mail
// and, in production, the second factor, then sets the session cookie
// (app/.server/session.ts). Needs JavaScript; never cached, never indexed.
//
// Second factor (TOTP, an authenticator app):
// - an account that has one types its code after the password;
// - an admin without one is refused by the server ("mfa_required") while the
//   page still holds the password sign-in, and enrols here: QR code → first
//   code → sign in again, this time with the code.
import { type FormEvent, type RefObject, useEffect, useRef, useState } from "react";
import { data, redirect, useNavigation, useSubmit } from "react-router";

import {
  completeTotpSignIn,
  finishTotpEnrollment,
  firebaseErrorCode,
  forgetSignIn,
  sendPasswordReset,
  sendVerificationEmail,
  signInWithPassword,
  startTotpEnrollment,
  type TotpSetup,
} from "~/.client/firebase";
import { ADMIN_HEADERS, REFUSAL_MESSAGE } from "~/.server/admin-guard";
import { firebaseWebConfig } from "~/.server/firebase";
import { createAdminSession, readAdminSession, type SignInResult } from "~/.server/session";
import { Button, Notice } from "~/components/ui";
import { adminMeta } from "~/lib/admin/meta";
import { safeAdminRedirect } from "~/lib/admin/redirect";
import { groupSecretKey, parseTotpCode, TOTP_CODE_LENGTH, TOTP_ERROR } from "~/lib/admin/totp";
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
const START_AGAIN = "A verificação demorou demais e foi interrompida. Entre novamente.";
const ASK_FOR_CODE = `Digite os ${TOTP_CODE_LENGTH} números que o app autenticador mostra agora.`;
const CLIENT_MESSAGE: Record<string, string> = {
  "auth/invalid-credential": WRONG_CREDENTIALS,
  "auth/invalid-email": WRONG_CREDENTIALS,
  "auth/user-not-found": WRONG_CREDENTIALS,
  "auth/wrong-password": WRONG_CREDENTIALS,
  "auth/missing-password": "Informe a sua senha.",
  "auth/user-disabled": "Esta conta está desativada.",
  "auth/too-many-requests": "Muitas tentativas seguidas. Aguarde alguns minutos ou crie uma nova senha.",
  "auth/network-request-failed": "Sem conexão com o serviço de login. Verifique a internet e tente novamente.",
  // Second factor
  "auth/invalid-verification-code": `Código incorreto ou vencido. ${ASK_FOR_CODE}`,
  "auth/missing-verification-code": ASK_FOR_CODE,
  "auth/invalid-multi-factor-session": START_AGAIN,
  "auth/missing-multi-factor-session": START_AGAIN,
  "auth/requires-recent-login": START_AGAIN,
  "auth/unverified-email": "Confirme o seu e-mail antes de configurar a verificação em duas etapas.",
  "auth/operation-not-allowed": "A verificação por app autenticador não está ativada no projeto do Firebase. Avise o responsável técnico.",
  "auth/maximum-second-factor-count-exceeded": "Esta conta já tem o número máximo de verificações em duas etapas. Avise o responsável técnico.",
  "auth/second-factor-already-in-use": "Este app autenticador já está ligado a esta conta. Entre novamente usando o código dele.",
  [TOTP_ERROR.unsupportedFactor]: "Esta conta usa outro tipo de verificação em duas etapas (por exemplo, SMS), que o painel não aceita. Avise o responsável técnico.",
  [TOTP_ERROR.unsupportedCodeLength]: "O projeto do Firebase gera códigos de um tamanho que o painel não aceita. Avise o responsável técnico.",
};
/** Errors after which the half-done sign-in or enrolment can't continue: back to the password. */
const RESTART = new Set(["auth/invalid-multi-factor-session", "auth/missing-multi-factor-session", "auth/requires-recent-login"]);
/** What failed, for errors without a message of their own. */
const FAILED = {
  signIn: "Não foi possível entrar",
  code: "Não foi possível verificar o código",
  enrolment: "Não foi possível configurar a verificação em duas etapas",
} as const;
const clientMessage = (code: string | null, failed: string = FAILED.signIn) =>
  (code && CLIENT_MESSAGE[code]) || `${failed}${code ? ` (${code})` : ""}. Tente novamente; se continuar, avise o responsável técnico.`;

const INPUT = "min-h-11 w-full rounded-[var(--radius-control)] border border-line-strong bg-paper px-3";

type ActionData = Route.ComponentProps["actionData"];
type Enrolment = TotpSetup & { qrDataUrl: string };

export default function AdminLogin({ loaderData, actionData }: Route.ComponentProps) {
  const { firebase, redirectTo, notice } = loaderData;
  const hydrated = useHydrated();
  const submit = useSubmit();
  const navigation = useNavigation();
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** The password was right and the account has an authenticator: now its code. */
  const [askCode, setAskCode] = useState(false);
  const [enrolment, setEnrolment] = useState<Enrolment | null>(null);
  /**
   * The server answer already dealt with: a new attempt started after it, or its
   * enrolment screen was finished or cancelled. Compared by identity — every
   * answer is a new object — so only a fresh answer shows its message or opens
   * the enrolment screen.
   */
  const [handled, setHandled] = useState<ActionData>(undefined);
  const busy = working || navigation.state !== "idle";
  const answer = actionData !== handled ? actionData : undefined;
  const enrolling = answer?.reason === "mfa_required";

  // The browser keeps its Firebase sign-in only until the server has answered, except when
  // the answer needs it: e-mail verification, or enrolling the second factor.
  useEffect(() => {
    if (actionData && actionData.reason !== "email_unverified" && actionData.reason !== "mfa_required") void forgetSignIn();
  }, [actionData]);
  useEffect(() => () => void forgetSignIn(), []);

  async function startOver() {
    await forgetSignIn();
    setAskCode(false);
    setEnrolment(null);
    setHandled(actionData);
  }

  async function cancel() {
    setError(null);
    await startOver();
  }

  /** Shows the error; returns true when the sign-in had to start over. */
  async function fail(err: unknown, failed: string): Promise<boolean> {
    const code = firebaseErrorCode(err);
    setError(clientMessage(code, failed));
    if (code && RESTART.has(code)) {
      await startOver();
      return true;
    }
    return false;
  }

  async function onPassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(null);
    setInfo(null);
    setHandled(actionData); // a new attempt: the last answer no longer applies
    try {
      const result = await signInWithPassword(firebase, emailRef.current!.value.trim(), passwordRef.current!.value);
      if (result.kind === "code_required") setAskCode(true);
      else await submit({ idToken: result.idToken, redirectTo }, { method: "post" });
    } catch (err) {
      await fail(err, FAILED.signIn);
      passwordRef.current?.focus();
    } finally {
      setWorking(false);
    }
  }

  async function onCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = parseTotpCode(codeRef.current?.value ?? "");
    if (!code) {
      setError(ASK_FOR_CODE);
      codeRef.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    try {
      const idToken = await completeTotpSignIn(code);
      setAskCode(false); // the server's answer shows on the first screen
      await submit({ idToken, redirectTo }, { method: "post" });
    } catch (err) {
      if (!(await fail(err, FAILED.code))) {
        codeRef.current?.select();
        codeRef.current?.focus();
      }
    } finally {
      setWorking(false);
    }
  }

  async function beginEnrolment() {
    setWorking(true);
    setError(null);
    try {
      const setup = await startTotpEnrollment(firebase);
      const { toDataURL } = await import("qrcode"); // only this screen needs it
      setEnrolment({ ...setup, qrDataUrl: await toDataURL(setup.otpauthUri, { errorCorrectionLevel: "M", margin: 2, width: 384 }) });
    } catch (err) {
      await fail(err, FAILED.enrolment);
    } finally {
      setWorking(false);
    }
  }

  async function finishEnrolment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = parseTotpCode(codeRef.current?.value ?? "");
    if (!code) {
      setError(ASK_FOR_CODE);
      codeRef.current?.focus();
      return;
    }
    setWorking(true);
    setError(null);
    try {
      await finishTotpEnrollment(firebase, code);
      await startOver();
      setInfo("Verificação em duas etapas ativada. Entre novamente: depois da senha, o painel vai pedir o código do app.");
    } catch (err) {
      if (!(await fail(err, FAILED.enrolment))) {
        codeRef.current?.select();
        codeRef.current?.focus();
      }
    } finally {
      setWorking(false);
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

  const serverMessage = answer && !busy && !enrolling ? answer.message : null;

  return (
    <main id="conteudo" className="grid min-h-dvh place-items-center bg-paper px-4 py-12">
      <div className="w-full max-w-sm space-y-6 border border-line bg-surface p-6 md:p-8">
        <div>
          <p className="eyebrow">Loja Iyanifa</p>
          <h1 className="mt-2 text-3xl">{enrolling ? "Verificação em duas etapas" : "Entrar no painel"}</h1>
        </div>

        <noscript>
          <Notice tone="warning">Para entrar no painel, ative o JavaScript neste navegador.</Notice>
        </noscript>
        {notice && !actionData && <Notice tone="warning">{notice}</Notice>}
        {serverMessage && <Notice tone={answer?.reason === "email_unverified" ? "warning" : "danger"}>{serverMessage}</Notice>}
        {error && <Notice tone="danger">{error}</Notice>}
        {info && <Notice tone="success">{info}</Notice>}

        {answer?.reason === "email_unverified" && !info && (
          <Button variant="secondary" className="w-full" onClick={sendVerification}>
            Enviar link de confirmação
          </Button>
        )}

        {enrolling ? (
          <EnrolmentStep enrolment={enrolment} busy={busy} codeRef={codeRef} onBegin={beginEnrolment} onFinish={finishEnrolment} onCancel={cancel} />
        ) : askCode ? (
          <CodeStep busy={busy} codeRef={codeRef} onSubmit={onCode} onCancel={cancel} />
        ) : (
          <>
            {/* method="post" and no name on the password: a submit before JavaScript loads can never put the password in a URL. */}
            <form method="post" onSubmit={onPassword} className="space-y-4">
              <div>
                <label htmlFor="email" className="mb-1 block text-sm">
                  E-mail
                </label>
                <input ref={emailRef} id="email" name="email" type="email" autoComplete="username" required className={INPUT} />
              </div>
              <div>
                <label htmlFor="password" className="mb-1 block text-sm">
                  Senha
                </label>
                <input ref={passwordRef} id="password" type="password" autoComplete="current-password" required className={INPUT} />
              </div>
              <Button type="submit" className="w-full" disabled={!hydrated || busy}>
                {busy ? "Entrando…" : "Entrar"}
              </Button>
            </form>

            <Button variant="ghost" className="text-sm" onClick={resetPassword} disabled={!hydrated || busy}>
              Esqueci minha senha
            </Button>
          </>
        )}
      </div>
    </main>
  );
}

function CodeInput({ id, codeRef }: { id: string; codeRef: RefObject<HTMLInputElement | null> }) {
  // No name: the code only ever leaves the page through the Firebase SDK.
  return (
    <input
      ref={codeRef}
      id={id}
      type="text"
      inputMode="numeric"
      autoComplete="one-time-code"
      required
      autoFocus
      className={`${INPUT} font-mono text-lg tracking-[0.3em]`}
    />
  );
}

function CodeStep({
  busy,
  codeRef,
  onSubmit,
  onCancel,
}: {
  busy: boolean;
  codeRef: RefObject<HTMLInputElement | null>;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <div>
        <label htmlFor="codigo" className="mb-1 block text-sm">
          Código do app autenticador
        </label>
        <CodeInput id="codigo" codeRef={codeRef} />
        <p className="mt-1 text-sm text-muted">Abra o app autenticador e digite o código da Loja Iyanifa.</p>
      </div>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? "Verificando…" : "Verificar"}
      </Button>
      <Button variant="ghost" className="text-sm" onClick={onCancel} disabled={busy}>
        Voltar
      </Button>
    </form>
  );
}

function EnrolmentStep({
  enrolment,
  busy,
  codeRef,
  onBegin,
  onFinish,
  onCancel,
}: {
  enrolment: Enrolment | null;
  busy: boolean;
  codeRef: RefObject<HTMLInputElement | null>;
  onBegin: () => void;
  onFinish: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
}) {
  return (
    <section aria-label="Configurar a verificação em duas etapas" className="space-y-4 text-sm">
      <p>
        O painel pede, além da senha, um código temporário gerado por um app autenticador no seu celular (por exemplo, Google Authenticator ou
        Microsoft Authenticator). Configure uma vez; depois, a cada entrada, digite o código que o app mostra.
      </p>
      {!enrolment ? (
        <Button className="w-full" onClick={onBegin} disabled={busy}>
          {busy ? "Preparando…" : "Configurar agora"}
        </Button>
      ) : (
        <form onSubmit={onFinish} className="space-y-4">
          <ol className="list-decimal space-y-4 pl-5">
            <li>
              No app, adicione uma conta escaneando este QR code:
              <img
                src={enrolment.qrDataUrl}
                width={192}
                height={192}
                alt="QR code que adiciona a conta da Loja Iyanifa ao app autenticador"
                className="mt-2 block border border-line"
              />
              <span className="mt-2 block text-muted">
                Está no celular que tem o app?{" "}
                <a href={enrolment.otpauthUri} className="underline underline-offset-4">
                  Abrir no app autenticador
                </a>
              </span>
            </li>
            <li>
              Se não puder escanear, digite esta chave no app:
              <code className="mt-1 block break-all font-mono text-base">{groupSecretKey(enrolment.secretKey)}</code>
            </li>
            <li>
              <label htmlFor="codigo-novo">Digite o código que o app passou a mostrar:</label>
              <span className="mt-2 block">
                <CodeInput id="codigo-novo" codeRef={codeRef} />
              </span>
            </li>
          </ol>
          <Button type="submit" className="w-full" disabled={busy}>
            {busy ? "Ativando…" : "Ativar verificação em duas etapas"}
          </Button>
        </form>
      )}
      <Button variant="ghost" className="text-sm" onClick={onCancel} disabled={busy}>
        Cancelar
      </Button>
    </section>
  );
}
