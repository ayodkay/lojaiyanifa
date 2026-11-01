import { describe, expect, it } from "vitest";

import { checkoutFieldErrors, checkoutFormToObject, checkoutSchema } from "~/lib/checkout";

const valid: Record<string, string> = {
  idempotencyKey: "7f3c2a10-5b9e-4c1d-8e2f-0a1b2c3d4e5f",
  name: "Maria da Silva",
  email: " Maria@Exemplo.com ",
  phone: "(21) 98765-4321",
  cpf: "529.982.247-25",
  shippingMethod: "flat_rate",
  cep: "21360-201",
  street: "Estrada do Portela",
  number: "99",
  complement: "",
  neighborhood: "Madureira",
  city: "Rio de Janeiro",
  state: "rj",
  acceptTerms: "on",
  items: JSON.stringify([{ productId: "p1", sku: "S-1", quantity: 2 }]),
};

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}
const parse = (fields: Record<string, string>) => checkoutSchema.safeParse(checkoutFormToObject(form(fields)));

describe("checkout form", () => {
  it("normalises a valid delivery order", () => {
    const result = parse(valid);
    expect(result.error?.issues).toBeUndefined();
    expect(result.data).toMatchObject({
      email: "maria@exemplo.com",
      phone: "+5521987654321",
      cpf: "52998224725",
      shippingMethod: "flat_rate",
      address: { cep: "21360201", state: "RJ", complement: null },
      acceptTerms: true,
      items: [{ productId: "p1", sku: "S-1", quantity: 2 }],
    });
  });

  it("accepts pickup without an address", () => {
    const result = parse({ ...valid, shippingMethod: "pickup", cep: "", street: "" });
    expect(result.success).toBe(true);
    expect(result.data?.address).toBeNull();
  });

  it("explains each invalid field in Portuguese, keyed by the input name", () => {
    const result = parse({ ...valid, name: "Maria", email: "maria@", phone: "1234", cpf: "529.982.247-26", cep: "123", state: "XX", acceptTerms: "" });
    expect(result.success).toBe(false);
    const errors = checkoutFieldErrors(result.error!);
    expect(Object.keys(errors).sort()).toEqual(["acceptTerms", "cep", "cpf", "email", "name", "phone", "state"]);
    expect(errors.cpf).toBe("CPF inválido.");
    expect(errors.name).toBe("Informe nome e sobrenome.");
  });

  it("requires an address for delivery", () => {
    const object = checkoutFormToObject(form(valid)) as Record<string, unknown>;
    const result = checkoutSchema.safeParse({ ...object, address: null });
    expect(checkoutFieldErrors(result.error!)).toEqual({ address: "Informe o endereço de entrega." });
  });

  it("refuses a missing or tampered cart", () => {
    expect(checkoutFieldErrors(parse({ ...valid, items: "not json" }).error!)).toHaveProperty("items");
    expect(checkoutFieldErrors(parse({ ...valid, items: JSON.stringify([]) }).error!)).toEqual({ items: "Seu carrinho está vazio." });
    const zero = JSON.stringify([{ productId: "p1", sku: "S-1", quantity: 0 }]);
    expect(parse({ ...valid, items: zero }).success).toBe(false);
  });
});
