import { describe, expect, it } from "vitest";

import { formatBrPhone, formatCep, formatCpf, isUf, isValidCnpj, isValidCpf, normalizeBrPhone, normalizeCep, phoneLink } from "~/lib/br";

describe("CPF / CNPJ", () => {
  it("checks CPF digits and refuses repeated digits", () => {
    expect(isValidCpf("52998224725")).toBe(true);
    expect(isValidCpf("52998224726")).toBe(false);
    expect(isValidCpf("11111111111")).toBe(false);
    expect(isValidCpf("529.982.247-25")).toBe(false); // digits only: callers strip punctuation first
    expect(formatCpf("52998224725")).toBe("529.982.247-25");
  });

  it("checks numeric and alphanumeric CNPJ digits", () => {
    expect(isValidCnpj("11222333000181")).toBe(true);
    expect(isValidCnpj("12ABC34501DE35")).toBe(true);
    expect(isValidCnpj("11222333000180")).toBe(false);
  });
});

describe("phones", () => {
  it("normalises the usual ways of typing a Brazilian number to E.164", () => {
    for (const typed of ["(21) 98765-4321", "21987654321", "+55 21 98765-4321", "55 21 98765 4321"]) {
      expect(normalizeBrPhone(typed)).toBe("+5521987654321");
    }
    expect(normalizeBrPhone("(21) 3456-7890")).toBe("+552134567890");
    expect(normalizeBrPhone("+55 21 3456-7890")).toBe("+552134567890");
  });

  it("refuses numbers that can't be Brazilian phones", () => {
    for (const bad of ["98765-4321", "(01) 98765-4321", "(21) 88765-4321", "(21) 1234-5678", "+1 202 555 0100", ""]) {
      expect(normalizeBrPhone(bad)).toBeNull();
    }
  });

  it("formats E.164 numbers for display", () => {
    expect(formatBrPhone("+5521987654321")).toBe("(21) 98765-4321");
    expect(formatBrPhone("+552134567890")).toBe("(21) 3456-7890");
  });

  it("shows a phone typed by hand formatted, with a tel:+55 link; anything else as typed", () => {
    expect(phoneLink("5521987654321")).toEqual({ text: "(21) 98765-4321", href: "tel:+5521987654321" });
    expect(phoneLink("(21) 3456-7890")).toEqual({ text: "(21) 3456-7890", href: "tel:+552134567890" });
    expect(phoneLink(" 0800 123 4567 ")).toEqual({ text: "0800 123 4567", href: "tel:08001234567" });
  });
});

describe("CEP and UF", () => {
  it("normalises and formats CEPs", () => {
    expect(normalizeCep("21360-201")).toBe("21360201");
    expect(normalizeCep("2136020")).toBeNull();
    expect(formatCep("21360201")).toBe("21360-201");
  });

  it("knows the 27 federative units", () => {
    expect(isUf("RJ")).toBe(true);
    expect(isUf("XX")).toBe(false);
  });
});
