import { describe, expect, it } from "vitest";

import {
  addressFormToObject,
  fieldErrors,
  firstName,
  profileSchema,
  registrationFormToObject,
  registrationSchema,
  safeAccountRedirect,
  savedAddressSchema,
} from "~/lib/account";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("registration and profile", () => {
  const valid = { name: "Maria da Silva", phone: "(21) 98765-4321", cpf: "529.982.247-25", acceptTerms: "on" };

  it("normalizes phone and CPF; marketing e-mails stay off unless ticked", () => {
    const parsed = registrationSchema.parse(registrationFormToObject(form(valid)));
    expect(parsed).toEqual({ name: "Maria da Silva", phone: "+5521987654321", cpf: "52998224725", marketingEmail: false, acceptTerms: true });
    expect(registrationSchema.parse(registrationFormToObject(form({ ...valid, marketingEmail: "on" }))).marketingEmail).toBe(true);
  });

  it("requires full name, a valid CPF and phone, and the terms", () => {
    const result = registrationSchema.safeParse(registrationFormToObject(form({ name: "Maria", phone: "123", cpf: "111.111.111-11" })));
    expect(result.success).toBe(false);
    expect(fieldErrors(result.error!)).toEqual({
      name: "Informe nome e sobrenome.",
      phone: "Telefone inválido: informe DDD e número, ex.: (21) 99999-9999.",
      cpf: "CPF inválido.",
      acceptTerms: "Para criar a conta, aceite os termos de uso e a política de privacidade.",
    });
  });

  it("the profile has no terms checkbox", () => {
    expect(profileSchema.safeParse({ name: "Maria da Silva", phone: "21987654321", cpf: "52998224725", marketingEmail: true }).success).toBe(true);
  });
});

describe("saved addresses", () => {
  it("parses an address with an optional label and the default flag", () => {
    const parsed = savedAddressSchema.parse(
      addressFormToObject(form({ cep: "21360-201", street: "Estrada do Portela", number: "99", complement: "", neighborhood: "Madureira", city: "Rio de Janeiro", state: "rj", label: " Casa ", isDefault: "on" })),
    );
    expect(parsed).toEqual({ cep: "21360201", street: "Estrada do Portela", number: "99", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ", label: "Casa", isDefault: true });
  });

  it("reports address errors by field name", () => {
    const result = savedAddressSchema.safeParse(addressFormToObject(form({ cep: "123" })));
    expect(Object.keys(fieldErrors(result.error!))).toEqual(expect.arrayContaining(["cep", "street", "number", "neighborhood", "city", "state"]));
  });
});

describe("safeAccountRedirect", () => {
  it("keeps paths on this site", () => {
    expect(safeAccountRedirect("/checkout")).toBe("/checkout");
    expect(safeAccountRedirect("/account/orders?pagina=2")).toBe("/account/orders?pagina=2");
  });

  it("refuses other origins, the admin and junk", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example", "javascript:alert(1)", "/admin", "/admin/orders", "/admin?x=1", "/a\nb", null, 42, `/${"x".repeat(600)}`]) {
      expect(safeAccountRedirect(bad)).toBe("/account");
    }
    expect(safeAccountRedirect("/administracao")).toBe("/administracao");
  });
});

describe("firstName", () => {
  it("takes the first word, or null", () => {
    expect(firstName("  Maria  da Silva ")).toBe("Maria");
    expect(firstName("")).toBeNull();
    expect(firstName(null)).toBeNull();
  });
});
