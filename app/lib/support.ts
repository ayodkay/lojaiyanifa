// Support tickets (docs/architecture.md §4.2 `tickets`): the contact form's schema, topics and statuses, shared by the
// page, the server and the admin. Messages are shown to customers (pt-BR).
import { z } from "zod";

import { normalizeBrPhone } from "~/lib/br";

export const TICKET_TOPICS = ["order", "payment", "shipping", "returns", "product", "privacy", "complaint", "other"] as const;
export type TicketTopic = (typeof TICKET_TOPICS)[number];

export const TOPIC_LABEL: Record<TicketTopic, string> = {
  order: "Pedido",
  payment: "Pagamento",
  shipping: "Entrega",
  returns: "Troca, devolução ou desistência",
  product: "Produto",
  privacy: "Privacidade e dados pessoais",
  complaint: "Reclamação",
  other: "Outro assunto",
};

/** Why the customer wants to send something back (topic "returns"). */
export const RETURN_REASONS = ["withdrawal", "defect", "wrong_item", "exchange", "other"] as const;
export type ReturnReason = (typeof RETURN_REASONS)[number];
export const RETURN_REASON_LABEL: Record<ReturnReason, string> = {
  withdrawal: "Desisti da compra (até 7 dias após receber)",
  defect: "O produto veio com defeito ou avariado",
  wrong_item: "Recebi um produto diferente do pedido",
  exchange: "Quero trocar por outro tamanho, cor ou modelo",
  other: "Outro motivo",
};

export const RETURN_PREFERENCES = ["refund", "exchange", "undecided"] as const;
export type ReturnPreference = (typeof RETURN_PREFERENCES)[number];
export const RETURN_PREFERENCE_LABEL: Record<ReturnPreference, string> = {
  refund: "Reembolso",
  exchange: "Troca por outro produto",
  undecided: "Quero conversar antes de decidir",
};

export const TICKET_STATUSES = ["open", "answered", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: "Aguardando a loja",
  answered: "Respondido",
  closed: "Encerrado",
};

export const MESSAGE_MIN = 10;
export const MESSAGE_MAX = 4000;
/** A form sent sooner than this after the page loaded was filled by a bot. */
export const MIN_FILL_MS = 3000;

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Use no máximo ${max} caracteres.`)
    .transform((v) => v || null);

export const contactSchema = z
  .object({
    name: z.string().trim().min(2, "Informe o seu nome.").max(120, "Use no máximo 120 caracteres."),
    email: z.string().trim().toLowerCase().max(254, "E-mail muito longo.").pipe(z.email({ error: "E-mail inválido." })),
    phone: z.string().transform((value, ctx) => {
      if (!value.trim()) return null;
      const phone = normalizeBrPhone(value);
      if (!phone) {
        ctx.addIssue({ code: "custom", message: "Telefone inválido: informe DDD e número, ex.: (21) 99999-9999." });
        return z.NEVER;
      }
      return phone;
    }),
    orderNumber: z
      .string()
      .trim()
      .transform((value, ctx) => {
        if (!value) return null;
        const digits = value.replace(/^#|^n[ºo°]?\s*/i, "");
        if (!/^\d{4,8}$/.test(digits)) {
          ctx.addIssue({ code: "custom", message: "Número do pedido inválido (só números, ex.: 1001)." });
          return z.NEVER;
        }
        return Number(digits);
      }),
    topic: z.enum(TICKET_TOPICS, { error: "Escolha o assunto." }),
    message: z
      .string()
      .trim()
      .min(MESSAGE_MIN, `Escreva pelo menos ${MESSAGE_MIN} caracteres.`)
      .max(MESSAGE_MAX, `Use no máximo ${MESSAGE_MAX} caracteres.`),
    returnReason: z.enum(RETURN_REASONS).nullable(),
    returnPreference: z.enum(RETURN_PREFERENCES).nullable(),
    returnItems: optionalText(500),
  })
  .superRefine((v, ctx) => {
    if (v.topic !== "returns") return;
    if (!v.orderNumber) ctx.addIssue({ code: "custom", path: ["orderNumber"], message: "Informe o número do pedido." });
    if (!v.returnReason) ctx.addIssue({ code: "custom", path: ["returnReason"], message: "Escolha o motivo." });
    if (!v.returnPreference) ctx.addIssue({ code: "custom", path: ["returnPreference"], message: "Escolha o que você prefere." });
  });

export type ContactInput = z.infer<typeof contactSchema>;

/**
 * The checks against bots that aren't fields of the ticket. Speed bumps, not a wall: Cloudflare (bot fight mode,
 * Turnstile) is the real protection. The fill time is measured in the browser, because the page is cached and
 * clocks differ.
 */
export interface ContactGuard {
  /** A field humans never see; anything typed there is a bot. */
  honeypot: string;
  /** Milliseconds between the form appearing and being sent, measured by the page (0 without JavaScript). */
  elapsedMs: number;
}

export function contactFormToObject(form: FormData): { input: unknown; guard: ContactGuard } {
  const text = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  const topic = text("topic");
  const isReturn = topic === "returns";
  return {
    input: {
      name: text("name"),
      email: text("email"),
      phone: text("phone"),
      orderNumber: text("orderNumber"),
      topic,
      message: text("message"),
      returnReason: isReturn ? text("returnReason") || null : null,
      returnPreference: isReturn ? text("returnPreference") || null : null,
      returnItems: isReturn ? text("returnItems") : "",
    },
    guard: { honeypot: text("website"), elapsedMs: Number(text("elapsedMs")) || 0 },
  };
}

/** Why a submission is treated as automated, or null. */
export function botReason(guard: ContactGuard): "honeypot" | "too_fast" | null {
  if (guard.honeypot.trim()) return "honeypot";
  if (!Number.isFinite(guard.elapsedMs) || guard.elapsedMs < MIN_FILL_MS) return "too_fast";
  return null;
}

export const isTicketTopic = (value: unknown): value is TicketTopic => typeof value === "string" && (TICKET_TOPICS as readonly string[]).includes(value);
