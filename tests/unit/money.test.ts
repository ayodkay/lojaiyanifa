import { describe, expect, it } from "vitest";

import { formatBRL, parseDecimalToCents, percentOff, toCents, toDecimalString } from "~/lib/money";

describe("parseDecimalToCents", () => {
  it("reads a number input's value exactly, without floating point", () => {
    expect(parseDecimalToCents("129.90")).toBe(12990);
    expect(parseDecimalToCents("129.9")).toBe(12990);
    expect(parseDecimalToCents("130")).toBe(13000);
    expect(parseDecimalToCents("0.29")).toBe(29); // 0.29 * 100 is 28.999… in floating point
    expect(parseDecimalToCents(" 25.00 ")).toBe(2500);
  });

  it("refuses commas, signs, exponents, empty and over-precise values", () => {
    for (const value of ["", "129,90", "-5", "+5", "1e3", "12.345", ".5", "5.", "1.234,56", "abc", "1 000"]) {
      expect(parseDecimalToCents(value)).toBeNull();
    }
  });
});


describe("money", () => {
  it("converts reais to integer centavos without float drift", () => {
    expect(toCents(129.9)).toBe(12990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(19.99)).toBe(1999);
    expect(toCents(null)).toBeNull();
    expect(toCents(undefined)).toBeNull();
    expect(toCents(Number.NaN)).toBeNull();
  });

  it("formats BRL the way pt-BR Intl does (non-breaking space)", () => {
    expect(formatBRL(12990)).toBe("R$ 129,90");
    expect(formatBRL(123456789)).toBe("R$ 1.234.567,89");
  });

  it("computes a real discount only when the original price is higher", () => {
    expect(percentOff(8000, 10000)).toBe(20);
    expect(percentOff(12990, 15990)).toBe(19);
    expect(percentOff(10000, 8000)).toBeNull();
    expect(percentOff(10000, 10000)).toBeNull();
    expect(percentOff(0, 100)).toBeNull();
  });

  it("prints decimal amounts with a dot and two places", () => {
    expect(toDecimalString(12990)).toBe("129.90");
    expect(toDecimalString(5)).toBe("0.05");
  });
});
