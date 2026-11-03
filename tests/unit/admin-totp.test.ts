import { describe, expect, it } from "vitest";

import { groupSecretKey, parseTotpCode } from "~/lib/admin/totp";

describe("parseTotpCode", () => {
  it("accepts six digits, also with the spaces or dash apps show in the middle", () => {
    expect(parseTotpCode("123456")).toBe("123456");
    expect(parseTotpCode(" 123 456 ")).toBe("123456");
    expect(parseTotpCode("123-456")).toBe("123456");
    expect(parseTotpCode("012345")).toBe("012345"); // a leading zero is a digit, not a number to drop
  });

  it("refuses anything that isn't exactly six digits", () => {
    for (const input of ["", "12345", "1234567", "12345a", "１２３４５６", "123.456", "abcdef"]) {
      expect(parseTotpCode(input)).toBeNull();
    }
  });
});

describe("groupSecretKey", () => {
  it("splits the key into groups of four, keeping a shorter last group", () => {
    expect(groupSecretKey("JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP")).toBe("JBSW Y3DP EHPK 3PXP JBSW Y3DP EHPK 3PXP");
    expect(groupSecretKey("ABCDEF")).toBe("ABCD EF");
    expect(groupSecretKey("AB CD EF")).toBe("ABCD EF");
    expect(groupSecretKey("")).toBe("");
  });
});
