import { describe, expect, it } from "vitest";

import { fieldErrors } from "~/lib/account";
import { botReason, contactFormToObject, contactSchema } from "~/lib/support";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};
const base = { name: "Maria da Silva", email: " Maria@Exemplo.com ", topic: "order", message: "Quando chega o meu pedido?", elapsedMs: "8000" };

describe("contact form", () => {
  it("parses a plain question: optional phone and order number may be empty", () => {
    const { input, guard } = contactFormToObject(form(base));
    expect(contactSchema.parse(input)).toEqual({
      name: "Maria da Silva",
      email: "maria@exemplo.com",
      phone: null,
      orderNumber: null,
      topic: "order",
      message: "Quando chega o meu pedido?",
      returnReason: null,
      returnPreference: null,
      returnItems: null,
    });
    expect(botReason(guard)).toBeNull();
  });

  it("accepts an order number written as nº 1001 or #1001, and normalizes the phone", () => {
    for (const written of ["1001", "nº 1001", "#1001", "Nº1001"]) {
      expect(contactSchema.parse(contactFormToObject(form({ ...base, orderNumber: written })).input).orderNumber).toBe(1001);
    }
    expect(contactSchema.parse(contactFormToObject(form({ ...base, phone: "(21) 98765-4321" })).input).phone).toBe("+5521987654321");
  });

  it("a return request needs the order, the reason and the preference", () => {
    const result = contactSchema.safeParse(contactFormToObject(form({ ...base, topic: "returns" })).input);
    expect(fieldErrors(result.error!)).toEqual({ orderNumber: "Informe o número do pedido.", returnReason: "Escolha o motivo.", returnPreference: "Escolha o que você prefere." });
    const ok = contactSchema.parse(contactFormToObject(form({ ...base, topic: "returns", orderNumber: "1001", returnReason: "withdrawal", returnPreference: "refund", returnItems: "2 × Colar" })).input);
    expect(ok).toMatchObject({ orderNumber: 1001, returnReason: "withdrawal", returnPreference: "refund", returnItems: "2 × Colar" });
  });

  it("drops return fields sent with another topic", () => {
    const parsed = contactSchema.parse(contactFormToObject(form({ ...base, returnReason: "defect", returnPreference: "refund", returnItems: "x" })).input);
    expect(parsed).toMatchObject({ returnReason: null, returnPreference: null, returnItems: null });
  });

  it("refuses short messages, bad e-mails and unknown topics", () => {
    const result = contactSchema.safeParse(contactFormToObject(form({ ...base, email: "x", message: "oi", topic: "spam" })).input);
    expect(Object.keys(fieldErrors(result.error!)).sort()).toEqual(["email", "message", "topic"]);
  });

  it("treats a filled honeypot, a form sent in under 3 s or one sent without the page's script as automated", () => {
    expect(botReason({ honeypot: "http://spam.example", elapsedMs: 9000 })).toBe("honeypot");
    expect(botReason({ honeypot: "", elapsedMs: 1200 })).toBe("too_fast");
    expect(botReason(contactFormToObject(form({ ...base, elapsedMs: "" })).guard)).toBe("too_fast");
    expect(botReason({ honeypot: "", elapsedMs: 3000 })).toBeNull();
  });
});
