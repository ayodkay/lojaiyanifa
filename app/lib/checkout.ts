// The checkout form: one schema for the browser (inline hints) and the server
// (the only validation that counts). Messages are shown to customers (pt-BR).
// Owner decision 2026-11-01: CPF is required at checkout.
import { z } from "zod";

import { isUf, isValidCpf, normalizeBrPhone, normalizeCep, onlyDigits } from "~/lib/br";
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "~/lib/cart/limits";
import { normalizeCouponCode } from "~/lib/discounts";

const required = (max: number, message: string) =>
  z.string().trim().min(1, message).max(max, `Use no máximo ${max} caracteres.`);

const cep = z.string().transform((value, ctx) => {
  const normalized = normalizeCep(value);
  if (!normalized) {
    ctx.addIssue({ code: "custom", message: "CEP inválido: use 8 dígitos, ex.: 21360-201." });
    return z.NEVER;
  }
  return normalized;
});

export const addressSchema = z.object({
  cep,
  street: required(120, "Informe a rua."),
  number: required(20, "Informe o número (ou S/N)."),
  complement: z.string().trim().max(80, "Use no máximo 80 caracteres.").transform((v) => v || null),
  neighborhood: required(80, "Informe o bairro."),
  city: required(80, "Informe a cidade."),
  state: z.string().trim().toUpperCase().refine(isUf, "Selecione o estado."),
});

export const checkoutSchema = z
  .object({
    /** Random per checkout attempt: prevents duplicate orders and doubles as the guest's order link secret. */
    idempotencyKey: z.uuid({ error: "Recarregue a página e tente novamente." }),
    name: required(120, "Informe seu nome completo.").refine((v) => v.split(/\s+/).length >= 2, "Informe nome e sobrenome."),
    email: z.string().trim().toLowerCase().max(254, "E-mail muito longo.").pipe(z.email({ error: "E-mail inválido." })),
    phone: z.string().transform((value, ctx) => {
      const phone = normalizeBrPhone(value);
      if (!phone) {
        const message = value.trim() ? "Telefone inválido: informe DDD e número, ex.: (21) 99999-9999." : "Informe seu celular com DDD.";
        ctx.addIssue({ code: "custom", message });
        return z.NEVER;
      }
      return phone;
    }),
    cpf: z.string().transform((value, ctx) => {
      const digits = onlyDigits(value);
      if (!isValidCpf(digits)) {
        ctx.addIssue({ code: "custom", message: digits ? "CPF inválido." : "Informe seu CPF." });
        return z.NEVER;
      }
      return digits;
    }),
    shippingMethod: z.enum(["flat_rate", "pickup"], { error: "Escolha a forma de entrega." }),
    address: addressSchema.nullable(),
    acceptTerms: z.literal(true, { error: "Para continuar, aceite os termos de uso e a política de privacidade." }),
    /** The coupon typed in the cart, if any; the order transaction decides whether it applies. */
    couponCode: z.string().transform((value, ctx) => {
      if (!value.trim()) return null;
      const code = normalizeCouponCode(value);
      if (!code) {
        ctx.addIssue({ code: "custom", message: "Cupom inválido. Confira o código." });
        return z.NEVER;
      }
      return code;
    }),
    items: z
      .array(
        z.object({
          productId: z.string().min(1).max(64),
          sku: z.string().min(1).max(100),
          quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
        }),
      )
      .min(1, "Seu carrinho está vazio.")
      .max(MAX_CART_LINES),
  })
  .superRefine((value, ctx) => {
    if (value.shippingMethod === "flat_rate" && !value.address) {
      ctx.addIssue({ code: "custom", path: ["address"], message: "Informe o endereço de entrega." });
    }
  });

export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const ADDRESS_FIELDS = ["cep", "street", "number", "complement", "neighborhood", "city", "state"] as const;

/** FormData from the checkout form → the plain object checkoutSchema expects. */
export function checkoutFormToObject(form: FormData): unknown {
  const get = (key: string) => {
    const value = form.get(key);
    return typeof value === "string" ? value : "";
  };
  let items: unknown = null;
  try {
    items = JSON.parse(get("items"));
  } catch {
    items = null; // reported by the schema as an invalid cart
  }
  const shippingMethod = get("shippingMethod");
  return {
    idempotencyKey: get("idempotencyKey"),
    name: get("name"),
    email: get("email"),
    phone: get("phone"),
    cpf: get("cpf"),
    shippingMethod,
    address: shippingMethod === "flat_rate" ? Object.fromEntries(ADDRESS_FIELDS.map((f) => [f, get(f)])) : null,
    acceptTerms: form.get("acceptTerms") === "on",
    couponCode: get("couponCode"),
    items,
  };
}

/** First error per form field, keyed by the input's name ("cep", not "address.cep"). */
export function checkoutFieldErrors(error: z.ZodError): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of error.issues) {
    const [first, second] = issue.path;
    const key = first === "address" && second !== undefined ? String(second) : String(first ?? "form");
    errors[key] ??= issue.message;
  }
  return errors;
}
