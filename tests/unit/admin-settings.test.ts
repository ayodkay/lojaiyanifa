import { describe, expect, it } from "vitest";

import { checkoutBlockers, PAYMENT_FIELDS, SHIPPING_FIELDS } from "~/.server/admin-settings";
import { maskPixKey, parsePaymentForm, parseShippingForm, parseVersion } from "~/.server/settings-forms";
import { can } from "~/lib/admin/roles";
import { paymentSettingsSchema, shippingSettingsSchema } from "~/lib/store-settings";

/** Banco Central's documentation key: a code made with it can't pay anyone. */
const TEST_KEY = "123E4567-E12B-12D1-A456-426655440000";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

const payment = (overrides: Record<string, string> = {}) =>
  form({ pixKey: TEST_KEY, merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro", expiryHours: "24", ...overrides });

describe("parsePaymentForm", () => {
  it("turns a valid form into the stored document, with the key as the DICT holds it", () => {
    expect(parsePaymentForm(payment())).toEqual({
      ok: true,
      value: {
        pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" },
        expiryHours: 24,
      },
    });
  });

  it("answers each mistake next to its field", () => {
    const result = parsePaymentForm(payment({ pixKey: "111.111.111-12", merchantName: "  ", merchantCity: "São João de Meriti", expiryHours: "0" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.pixKey).toMatch(/CPF inválido/);
    expect(result.errors.merchantName).toBe("Informe o nome do recebedor.");
    expect(result.errors.merchantCity).toMatch(/no máximo 15 caracteres/);
    expect(result.errors.expiryHours).toMatch(/entre 1 e 168/);
    const tooLong = parsePaymentForm(payment({ expiryHours: "169" }));
    expect(tooLong.ok ? null : tooLong.errors).toEqual({ expiryHours: expect.stringMatching(/entre 1 e 168/) });
  });
});

const shipping = (overrides: Record<string, string> = {}) =>
  form({
    handlingDays: "1",
    flatRateEnabled: "yes",
    flatRateLabel: "Entrega em todo o Brasil",
    flatRatePrice: "25.00",
    transitMin: "",
    transitMax: "",
    pickupEnabled: "yes",
    pickupLabel: "Retirar na loja",
    pickupAddress: "Rua de Teste, 100 – Centro, Rio de Janeiro – RJ",
    pickupInstructions: "",
    ...overrides,
  });

describe("parseShippingForm", () => {
  it("turns a valid form into the stored document: centavos, on/off, no estimate when the days are blank", () => {
    expect(parseShippingForm(shipping({ pickupEnabled: "" }))).toEqual({
      ok: true,
      value: {
        handlingDays: 1,
        flatRate: { enabled: true, label: "Entrega em todo o Brasil", priceCents: 2500, transitDays: null },
        pickup: { enabled: false, label: "Retirar na loja", address: "Rua de Teste, 100 – Centro, Rio de Janeiro – RJ", instructions: null },
      },
    });
  });

  it("answers each mistake next to its field", () => {
    const result = parseShippingForm(shipping({ handlingDays: "31", flatRatePrice: "25,00", transitMin: "3", pickupAddress: " " }));
    expect(result.ok ? null : result.errors).toEqual({
      handlingDays: expect.stringMatching(/entre 0 e 30/),
      flatRatePrice: expect.stringMatching(/valor do frete/),
      transitDays: expect.stringMatching(/os dois prazos/),
      pickupAddress: "Informe o endereço de retirada.",
    });
    const inverted = parseShippingForm(shipping({ transitMin: "8", transitMax: "3" }));
    expect(inverted.ok ? null : inverted.errors).toEqual({ transitDays: "O prazo máximo não pode ser menor que o mínimo." });
  });
});

describe("maskPixKey", () => {
  it("keeps the key's type and last four characters for the audit log, never the key", () => {
    expect(maskPixKey(TEST_KEY)).toBe("chave aleatória …0000");
    expect(maskPixKey("+55 21 98765-4321")).toBe("telefone …4321");
    expect(maskPixKey("Loja@Exemplo.com")).toBe("e-mail ….com");
    expect(maskPixKey("529.982.247-25")).toBe("CPF …4725");
    expect(maskPixKey("não é chave")).toBe("chave inválida …have");
  });
});

describe("parseVersion", () => {
  it("accepts the version a page was rendered with, and nothing else", () => {
    expect(parseVersion(form({ version: "none" }))).toBe("none");
    expect(parseVersion(form({ version: "1762207200.123456789" }))).toBe("1762207200.123456789");
    for (const bad of ["", "1762207200", "1762207200.1234", "none ", "1762207200.123456789x"]) {
      expect(parseVersion(form({ version: bad })), JSON.stringify(bad)).toBeNull();
    }
    expect(parseVersion(form({}))).toBeNull();
  });
});

describe("who may see and change the settings (docs/architecture.md §3)", () => {
  it("lets the owner change them, an admin only look, and staff neither", () => {
    expect([can("owner", "settings.view"), can("admin", "settings.view"), can("staff", "settings.view")]).toEqual([true, true, false]);
    expect([can("owner", "settings.edit"), can("admin", "settings.edit"), can("staff", "settings.edit")]).toEqual([true, false, false]);
  });
});

describe("checkoutBlockers", () => {
  const pix = { pix: { key: TEST_KEY, merchantName: "Loja Teste", merchantCity: "Rio de Janeiro" } };
  const delivery = { flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: false, address: "Rua de Teste, 100" } };

  it("lets checkout open only with a Pix code that can be built and at least one way to deliver", () => {
    expect(checkoutBlockers(undefined, undefined)).toEqual(["Falta salvar o pagamento Pix.", "Falta salvar as formas de entrega."]);
    expect(checkoutBlockers(pix, { ...delivery, flatRate: { enabled: false, priceCents: 2500 } })).toEqual(["Ative ao menos uma forma de entrega."]);
    expect(checkoutBlockers({ pix: { ...pix.pix, key: "111.111.111-12" } }, delivery)).toEqual([expect.stringMatching(/^Pagamento Pix: CPF inválido/)]);
    expect(checkoutBlockers(pix, delivery)).toEqual([]);
  });
});

/** "a.b" for every value that isn't a plain object (null and arrays included). */
const leafPaths = (value: unknown, prefix = ""): string[] =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? Object.entries(value).flatMap(([key, inner]) => leafPaths(inner, prefix ? `${prefix}.${key}` : key))
    : [prefix];

describe("the audit log's field lists", () => {
  it("cover every stored settings field, so no change goes unrecorded", () => {
    const paymentSample = paymentSettingsSchema.parse({ pix: { key: "k", merchantName: "n", merchantCity: "c" } });
    const shippingSample = shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 0 }, pickup: { enabled: true, address: "a" } });
    expect(PAYMENT_FIELDS.map((f) => f.field).sort()).toEqual(leafPaths(paymentSample).sort());
    expect(SHIPPING_FIELDS.map((f) => f.field).sort()).toEqual(leafPaths(shippingSample).sort());
  });
});
