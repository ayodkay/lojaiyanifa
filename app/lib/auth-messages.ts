// Firebase Auth error codes (browser SDK) → what the customer pages say (pt-BR). Admin sign-in has its own table.

const WRONG_CREDENTIALS = "E-mail ou senha incorretos.";

const MESSAGES: Record<string, string> = {
  "auth/invalid-credential": WRONG_CREDENTIALS,
  "auth/user-not-found": WRONG_CREDENTIALS,
  "auth/wrong-password": WRONG_CREDENTIALS,
  "auth/invalid-email": "E-mail inválido.",
  "auth/missing-email": "Informe o seu e-mail.",
  "auth/missing-password": "Informe a sua senha.",
  "auth/user-disabled": "Esta conta está desativada. Fale com a loja.",
  "auth/too-many-requests": "Muitas tentativas seguidas. Aguarde alguns minutos e tente de novo.",
  "auth/network-request-failed": "Sem conexão. Verifique a internet e tente novamente.",
  "auth/email-already-in-use": "Já existe uma conta com este e-mail. Entre nela ou crie uma nova senha.",
  "auth/weak-password": "Senha fraca: use pelo menos 8 caracteres, misturando letras e números.",
  "auth/password-does-not-meet-requirements": "A senha não atende aos requisitos de segurança. Use pelo menos 8 caracteres, misturando letras e números.",
  "auth/requires-recent-login": "Por segurança, digite a senha de novo e repita a operação.",
  "auth/multi-factor-auth-required": "Esta conta usa verificação em duas etapas (conta do painel). Para comprar como cliente, use outro e-mail.",
  "app/second-factor-account": "Esta conta usa verificação em duas etapas (conta do painel). Para comprar como cliente, use outro e-mail.",
};

/** The message for a Firebase (or "app/…") error code; unknown codes say what failed and keep the code for support. */
export function authMessage(code: string | null, failed = "Não foi possível concluir"): string {
  return (code && MESSAGES[code]) || `${failed}${code ? ` (${code})` : ""}. Tente novamente; se continuar, fale com a loja.`;
}
