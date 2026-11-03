import { describe, expect, it } from "vitest";

import { canRefund, parseRefundForm, restockable, restockByDefault, restockField, statusAfterRefund } from "~/lib/admin/refunds";

describe("refund rules", () => {
  it("apply to paid orders until fully refunded, never to unpaid or cancelled ones", () => {
    for (const status of ["paid", "processing", "shipped", "delivered", "partially_refunded"] as const) expect(canRefund(status)).toBe(true);
    for (const status of ["pending_payment", "cancelled", "refunded"] as const) expect(canRefund(status)).toBe(false);
  });

  it("end the order on a full refund and leave it partially refunded otherwise", () => {
    expect(statusAfterRefund(10000, 0, 10000)).toBe("refunded");
    expect(statusAfterRefund(10000, 0, 2500)).toBe("partially_refunded");
    expect(statusAfterRefund(10000, 2500, 7500)).toBe("refunded"); // the second refund completes it
    expect(statusAfterRefund(10000, 2500, 7499)).toBe("partially_refunded");
  });

  it("restock what the order took from stock, minus what earlier refunds put back; untracked SKUs have no entry", () => {
    const sold = [
      { sku: "COLAR-1", quantity: 3 },
      { sku: "BRINCO-1", quantity: 1 },
    ];
    expect(restockable(sold, [])).toEqual(new Map([["COLAR-1", 3], ["BRINCO-1", 1]]));
    expect(restockable(sold, [{ restock: [{ sku: "COLAR-1", quantity: 2 }] }, { restock: [] }])).toEqual(new Map([["COLAR-1", 1], ["BRINCO-1", 1]]));
    expect(restockable([], [])).toEqual(new Map());
  });

  it("put units back by default only while the order hasn't left the store", () => {
    const stages = ["unfulfilled", "processing", "shipped", "delivered"] as const;
    expect(stages.map((s) => restockByDefault(s, "flat_rate"))).toEqual([true, true, false, false]);
    // A pickup order that is "ready for pickup" is still on the counter: it leaves when picked up.
    expect(stages.map((s) => restockByDefault(s, "pickup"))).toEqual([true, true, true, false]);
  });
});

const KEY = "123e4567-e89b-42d3-a456-426614174000";
const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const limits = { remainingCents: 15490, restockable: new Map([["COLAR-1", 2]]) };
const valid = { key: KEY, amount: "129.90", reason: "out_of_stock", confirmed: "yes", [restockField("COLAR-1")]: "1" };

describe("refund form", () => {
  it("reads amount in centavos, reason, optional note and the units going back to stock", () => {
    expect(parseRefundForm(form({ ...valid, note: " Colar quebrado no estoque " }), limits)).toEqual({
      ok: true,
      value: { key: KEY, amountCents: 12990, reason: "out_of_stock", note: "Colar quebrado no estoque", restock: [{ sku: "COLAR-1", quantity: 1 }] },
    });
    expect(parseRefundForm(form({ ...valid, [restockField("COLAR-1")]: "0" }), limits)).toMatchObject({ ok: true, value: { restock: [] } });
    // A SKU the order didn't take from stock is ignored, whatever the form says.
    expect(parseRefundForm(form({ ...valid, [restockField("PULS-1")]: "5" }), limits)).toMatchObject({ ok: true, value: { restock: [{ sku: "COLAR-1", quantity: 1 }] } });
  });

  it("refuses more than remains to refund, zero, and amounts that aren't a number input's value", () => {
    expect(parseRefundForm(form({ ...valid, amount: "154.90" }), limits).ok).toBe(true); // exactly the rest
    for (const amount of ["154.91", "0", "0.00", "129,90", "-10", ""]) {
      expect(parseRefundForm(form({ ...valid, amount }), limits)).toMatchObject({ ok: false, errors: { amount: expect.any(String) } });
    }
  });

  it("refuses restocking more than the order took, negative or fractional quantities", () => {
    for (const quantity of ["3", "-1", "1.5", "um"]) {
      expect(parseRefundForm(form({ ...valid, [restockField("COLAR-1")]: quantity }), limits)).toMatchObject({ ok: false, errors: { restock: expect.stringContaining("entre 0 e 2") } });
    }
  });

  it("needs the bank confirmation, a reason, a note for 'other', and the form's key", () => {
    expect(parseRefundForm(form({ ...valid, confirmed: "" }), limits)).toMatchObject({ ok: false, errors: { confirmed: expect.any(String) } });
    expect(parseRefundForm(form({ ...valid, reason: "nope" }), limits)).toMatchObject({ ok: false, errors: { reason: expect.any(String) } });
    expect(parseRefundForm(form({ ...valid, reason: "other" }), limits)).toMatchObject({ ok: false, errors: { note: "Descreva o motivo." } });
    expect(parseRefundForm(form({ ...valid, key: "not-a-uuid" }), limits)).toMatchObject({ ok: false, errors: { key: expect.any(String) } });
  });
});
