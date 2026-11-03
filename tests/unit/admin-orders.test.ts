import { describe, expect, it } from "vitest";

import { CANCEL_NOTE_MAX, parseCancelForm, parseOrderCursor, parseOrderFilter, parseOrderNumber } from "~/lib/admin/orders";

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
};

describe("parseCancelForm", () => {
  it("accepts a reason with an optional, trimmed note", () => {
    expect(parseCancelForm(form({ reason: "payment_not_received" }))).toEqual({ ok: true, value: { reason: "payment_not_received", note: null } });
    expect(parseCancelForm(form({ reason: "customer_request", note: "   " }))).toEqual({ ok: true, value: { reason: "customer_request", note: null } });
    expect(parseCancelForm(form({ reason: "customer_request", note: "  Desistiu  " }))).toEqual({ ok: true, value: { reason: "customer_request", note: "Desistiu" } });
  });

  it("requires a known reason, and a note when the reason is 'other'", () => {
    expect(parseCancelForm(form({}))).toEqual({ ok: false, errors: { reason: "Escolha o motivo do cancelamento." } });
    expect(parseCancelForm(form({ reason: "fraud" }))).toEqual({ ok: false, errors: { reason: "Escolha o motivo do cancelamento." } });
    expect(parseCancelForm(form({ reason: "other", note: " " }))).toEqual({ ok: false, errors: { note: "Descreva o motivo." } });
    expect(parseCancelForm(form({ reason: "other", note: "Produto danificado" }))).toEqual({ ok: true, value: { reason: "other", note: "Produto danificado" } });
  });

  it("limits the note length", () => {
    expect(parseCancelForm(form({ reason: "other", note: "x".repeat(CANCEL_NOTE_MAX) })).ok).toBe(true);
    expect(parseCancelForm(form({ reason: "other", note: "x".repeat(CANCEL_NOTE_MAX + 1) }))).toEqual({ ok: false, errors: { note: "Use no máximo 500 caracteres." } });
  });
});

describe("admin order URL parameters", () => {
  it("parses order numbers and cursors strictly", () => {
    expect(parseOrderNumber("1001")).toBe(1001);
    for (const bad of [undefined, "", "10a", "-1", "1.5", "1e3", " 1001", "1234567890"]) expect(parseOrderNumber(bad)).toBeNull();
    expect(parseOrderCursor("1050")).toBe(1050);
    expect(parseOrderCursor(null)).toBeNull();
  });

  it("falls back to the work queue for unknown tabs", () => {
    expect(parseOrderFilter("paid")).toBe("paid");
    expect(parseOrderFilter("all")).toBe("all");
    for (const tab of ["processing", "shipped", "delivered", "partially_refunded", "refunded"]) expect(parseOrderFilter(tab)).toBe(tab);
    for (const unknown of ["REFUNDED", "unfulfilled", "x", ""]) expect(parseOrderFilter(unknown)).toBe("pending_payment");
    expect(parseOrderFilter(null)).toBe("pending_payment");
  });
});
