import { createStaticPix, hasError } from "pix-utils";
import { describe, expect, it } from "vitest";

import { brCodeText, buildPixPayment, parsePixKey, PixConfigError, pixQrSvg, pixTxid } from "~/.server/pix";

// --- Independent reference implementations (deliberately not the library) -------------------

/** CRC16/CCITT-FALSE as the BR Code specifies (polynomial 0x1021, initial value 0xFFFF). */
function crc16(payload: string): string {
  let crc = 0xffff;
  for (const byte of new TextEncoder().encode(payload)) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
  }
  return crc.toString(16).toUpperCase().padStart(4, "0");
}

/** Splits an EMV payload into { id: value } (2-character ID, 2-digit length). */
function tlv(payload: string): Record<string, string> {
  const fields: Record<string, string> = {};
  for (let i = 0; i < payload.length; ) {
    const id = payload.slice(i, i + 2);
    const length = Number(payload.slice(i + 2, i + 4));
    fields[id] = payload.slice(i + 4, i + 4 + length);
    i += 4 + length;
  }
  return fields;
}

// The example in Banco Central's "Manual de Padrões para Iniciação do Pix".
const BCB_EXAMPLE =
  "00020126580014br.gov.bcb.pix0136123e4567-e12b-12d1-a456-4266554400005204000053039865802BR5913Fulano de Tal6008BRASILIA62070503***63041D3D";

describe("reference implementations vs the BCB manual", () => {
  it("computes the official example's CRC (1D3D) and parses its fields", () => {
    expect(crc16(BCB_EXAMPLE.slice(0, -4))).toBe("1D3D");
    const f = tlv(BCB_EXAMPLE);
    expect(f["59"]).toBe("Fulano de Tal");
    expect(tlv(f["26"]!)).toEqual({ "00": "br.gov.bcb.pix", "01": "123e4567-e12b-12d1-a456-426655440000" });
    expect(f["63"]).toBe("1D3D");
  });

  it("pix-utils reproduces the example except that it uppercases the name", () => {
    const pix = createStaticPix({
      merchantName: "Fulano de Tal",
      merchantCity: "BRASILIA",
      pixKey: "123e4567-e12b-12d1-a456-426655440000",
      transactionAmount: 0,
    });
    if (hasError(pix)) throw new Error(pix.message);
    const uppercased = BCB_EXAMPLE.slice(0, -4).replace("Fulano de Tal", "FULANO DE TAL");
    expect(pix.toBRCode()).toBe(uppercased + crc16(uppercased));
  });
});

describe("buildPixPayment", () => {
  const settings = { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "São Paulo" };

  it("produces a BR Code that is valid field by field, with the exact amount, key and txid", () => {
    const { brCode, keyType, amountCents, txid } = buildPixPayment(settings, 12990, "PEDIDO1001");
    const f = tlv(brCode);
    expect(f["00"]).toBe("01"); // payload format indicator
    expect(tlv(f["26"]!)).toEqual({ "00": "br.gov.bcb.pix", "01": "123e4567-e12b-12d1-a456-426655440000" });
    expect(f["52"]).toBe("0000"); // merchant category code
    expect(f["53"]).toBe("986"); // BRL
    expect(f["54"]).toBe("129.90");
    expect(f["58"]).toBe("BR");
    expect(f["59"]).toBe("LOJA IYANIFA");
    expect(f["60"]).toBe("SAO PAULO");
    expect(tlv(f["62"]!)).toEqual({ "05": "PEDIDO1001" });
    expect(f["63"]).toBe(crc16(brCode.slice(0, -4)));
    expect({ keyType, amountCents, txid }).toEqual({ keyType: "evp", amountCents: 12990, txid: "PEDIDO1001" });
  });

  it("refuses amounts that aren't whole centavos above zero (pix-utils accepts −5)", () => {
    for (const bad of [0, -500, 12.5]) expect(() => buildPixPayment(settings, bad, "PEDIDO1")).toThrow(/amount/);
  });

  it("refuses txids outside 1–25 letters/digits (pix-utils accepts 'PEDIDO-1001')", () => {
    for (const bad of ["PEDIDO-1001", "X".repeat(26), ""]) expect(() => buildPixPayment(settings, 100, bad)).toThrow(/txid/);
  });

  it("reports a missing key, name or city as a configuration error (pix-utils accepts an empty key)", () => {
    expect(() => buildPixPayment({ ...settings, key: "" }, 100, "P1")).toThrow(PixConfigError);
    expect(() => buildPixPayment({ ...settings, merchantName: " " }, 100, "P1")).toThrow(PixConfigError);
    expect(() => buildPixPayment({ ...settings, merchantCity: "🙂" }, 100, "P1")).toThrow(PixConfigError);
  });
});

describe("parsePixKey", () => {
  it("accepts CPF and CNPJ with or without punctuation, checking the digits", () => {
    expect(parsePixKey("529.982.247-25")).toEqual({ type: "cpf", value: "52998224725" });
    expect(parsePixKey("11.222.333/0001-81")).toEqual({ type: "cnpj", value: "11222333000181" });
    // Alphanumeric CNPJ (Receita Federal example; check digits recomputed on 2026-11-01).
    expect(parsePixKey("12.ABC.345/01DE-35")).toEqual({ type: "cnpj", value: "12ABC34501DE35" });
  });

  it("rejects wrong check digits and repeated digits", () => {
    for (const bad of ["529.982.247-26", "11.222.333/0001-80", "111.111.111-11", "12.ABC.345/01DE-36"]) {
      expect(() => parsePixKey(bad)).toThrow(PixConfigError);
    }
  });

  it("normalises phones to +55 + DDD + number and refuses other formats", () => {
    expect(parsePixKey("+55 (11) 99876-5432")).toEqual({ type: "phone", value: "+5511998765432" });
    expect(parsePixKey("+55 11 3456-7890")).toEqual({ type: "phone", value: "+551134567890" });
    for (const bad of ["+1 202 555 0100", "+55 11 1234"]) expect(() => parsePixKey(bad)).toThrow(PixConfigError);
  });

  it("reads 11 bare digits as a CPF, and points to the phone format when that CPF is invalid", () => {
    expect(() => parsePixKey("11998765432")).toThrow(/\+55/);
  });

  it("lowercases e-mails and random keys, and rejects anything else", () => {
    expect(parsePixKey(" Loja@Exemplo.com.br ")).toEqual({ type: "email", value: "loja@exemplo.com.br" });
    expect(parsePixKey("123E4567-E12B-12D1-A456-426655440000")).toEqual({ type: "evp", value: "123e4567-e12b-12d1-a456-426655440000" });
    for (const bad of ["loja@", "chave-qualquer", "12345"]) expect(() => parsePixKey(bad)).toThrow(PixConfigError);
  });
});

describe("BR Code text, txid and QR", () => {
  it("strips accents and symbols, uppercases and cuts to the field limit", () => {
    expect(brCodeText("São João d'Aliança", 25)).toBe("SAO JOAO D'ALIANCA");
    expect(brCodeText("Loja Iyanifa Artigos Religiosos Ltda", 25)).toBe("LOJA IYANIFA ARTIGOS RELI");
    expect(brCodeText("  Axé 🙏  Brasil ", 15)).toBe("AXE BRASIL");
  });

  it("builds order txids that the BR Code accepts", () => {
    expect(pixTxid(1001)).toBe("PEDIDO1001");
    for (const bad of [0, -1, 1.5]) expect(() => pixTxid(bad)).toThrow();
  });

  it("renders the QR code as an SVG, deterministically", async () => {
    const svg = await pixQrSvg("00020126580014br.gov.bcb.pix");
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toMatch(/viewBox="0 0 \d+ \d+"/);
    expect(await pixQrSvg("00020126580014br.gov.bcb.pix")).toBe(svg);
  });
});
