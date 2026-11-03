import { describe, expect, it } from "vitest";

import { NOTE_MAX, parseNote, parseStepForm, parseTracking } from "~/lib/admin/fulfillment";
import { canEditTracking, canTakeStep, type FulfillmentStage, orderStatusLabel, type OrderStatus, statusAfterStep } from "~/lib/orders";

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("tracking form", () => {
  it("accepts nothing at all, or a carrier alone, or carrier + code + https link (trimmed)", () => {
    expect(parseTracking(form({}))).toEqual({ ok: true, value: { carrier: null, trackingCode: null, trackingUrl: null } });
    expect(parseTracking(form({ carrier: " Motoboy " }))).toEqual({ ok: true, value: { carrier: "Motoboy", trackingCode: null, trackingUrl: null } });
    expect(parseTracking(form({ carrier: "Correios", trackingCode: " AA123456789BR ", trackingUrl: "https://rastreamento.example.com/AA123456789BR" }))).toEqual({
      ok: true,
      value: { carrier: "Correios", trackingCode: "AA123456789BR", trackingUrl: "https://rastreamento.example.com/AA123456789BR" },
    });
  });

  it("asks for the carrier when there is a code or a link", () => {
    expect(parseTracking(form({ trackingCode: "AA123456789BR" }))).toEqual({ ok: false, errors: { carrier: "Informe a transportadora." } });
    expect(parseTracking(form({ trackingUrl: "https://example.com/x" }))).toMatchObject({ ok: false, errors: { carrier: expect.any(String) } });
  });

  it("refuses links that aren't https (no javascript:, data: or plain http) and over-long or multi-line fields", () => {
    for (const trackingUrl of ["javascript:alert(1)", "data:text/html,x", "http://example.com/x", "example.com/x", `https://example.com/${"a".repeat(500)}`]) {
      expect(parseTracking(form({ carrier: "Correios", trackingUrl }))).toMatchObject({ ok: false, errors: { trackingUrl: expect.any(String) } });
    }
    expect(parseTracking(form({ carrier: "x".repeat(61) }))).toMatchObject({ ok: false, errors: { carrier: expect.any(String) } });
    expect(parseTracking(form({ carrier: "Correios", trackingCode: "AA1\nBR" }))).toMatchObject({ ok: false, errors: { trackingCode: expect.any(String) } });
  });
});

describe("step form", () => {
  it("reads tracking only when a delivery order is marked shipped", () => {
    expect(parseStepForm(form({ step: "processing", carrier: "ignored" }), "flat_rate")).toEqual({ ok: true, value: { step: "processing", tracking: null } });
    expect(parseStepForm(form({ step: "shipped", carrier: "Correios", trackingCode: "AA123456789BR" }), "flat_rate")).toEqual({
      ok: true,
      value: { step: "shipped", tracking: { carrier: "Correios", trackingCode: "AA123456789BR", trackingUrl: null } },
    });
    expect(parseStepForm(form({ step: "shipped", trackingCode: "ignored for pickup" }), "pickup")).toEqual({ ok: true, value: { step: "shipped", tracking: null } });
  });

  it("needs the confirmation box to mark delivered, and refuses unknown steps", () => {
    expect(parseStepForm(form({ step: "delivered" }), "flat_rate")).toMatchObject({ ok: false, errors: { step: expect.stringContaining("entrega") } });
    expect(parseStepForm(form({ step: "delivered" }), "pickup")).toMatchObject({ ok: false, errors: { step: expect.stringContaining("retirou") } });
    expect(parseStepForm(form({ step: "delivered", confirmed: "yes" }), "pickup")).toEqual({ ok: true, value: { step: "delivered", tracking: null } });
    for (const step of ["", "unfulfilled", "cancelled", "SHIPPED"]) expect(parseStepForm(form({ step }), "flat_rate").ok).toBe(false);
  });
});

describe("internal note", () => {
  it("is trimmed, required and at most 1000 characters", () => {
    expect(parseNote(form({ text: "  Cliente pediu embrulho para presente.  " }))).toEqual({ ok: true, value: "Cliente pediu embrulho para presente." });
    expect(parseNote(form({ text: "   " })).ok).toBe(false);
    expect(parseNote(form({})).ok).toBe(false);
    expect(parseNote(form({ text: "x".repeat(NOTE_MAX) })).ok).toBe(true);
    expect(parseNote(form({ text: "x".repeat(NOTE_MAX + 1) })).ok).toBe(false);
  });
});

describe("fulfilment steps", () => {
  it("only go forward, and 'processing' may be skipped", () => {
    expect(canTakeStep("paid", "unfulfilled", "processing")).toBe(true);
    expect(canTakeStep("paid", "unfulfilled", "shipped")).toBe(true);
    expect(canTakeStep("paid", "unfulfilled", "delivered")).toBe(true); // e.g. handed over at the counter
    expect(canTakeStep("processing", "processing", "shipped")).toBe(true);
    expect(canTakeStep("shipped", "shipped", "delivered")).toBe(true);

    const backwardsOrRepeated: [OrderStatus, FulfillmentStage, "processing" | "shipped" | "delivered"][] = [
      ["processing", "processing", "processing"],
      ["shipped", "shipped", "processing"],
      ["shipped", "shipped", "shipped"],
      ["delivered", "delivered", "shipped"],
      ["delivered", "delivered", "delivered"],
    ];
    for (const [status, stage, step] of backwardsOrRepeated) expect(canTakeStep(status, stage, step)).toBe(false);
  });

  it("are refused before payment, after cancellation and after a full refund, but go on after a partial refund", () => {
    for (const status of ["pending_payment", "cancelled", "refunded"] as const) {
      expect(canTakeStep(status, "unfulfilled", "processing")).toBe(false);
    }
    expect(canTakeStep("partially_refunded", "processing", "shipped")).toBe(true);
  });

  it("set the status to the stage, except on a partially refunded order, which keeps that status", () => {
    expect(statusAfterStep("paid", "processing")).toBe("processing");
    expect(statusAfterStep("processing", "shipped")).toBe("shipped");
    expect(statusAfterStep("shipped", "delivered")).toBe("delivered");
    expect(statusAfterStep("partially_refunded", "shipped")).toBe("partially_refunded");
  });

  it("allow editing tracking once shipped or delivered, unless cancelled", () => {
    expect(canEditTracking("shipped", "shipped")).toBe(true);
    expect(canEditTracking("partially_refunded", "delivered")).toBe(true);
    expect(canEditTracking("paid", "unfulfilled")).toBe(false);
    expect(canEditTracking("processing", "processing")).toBe(false);
    expect(canEditTracking("cancelled", "unfulfilled")).toBe(false);
  });

  it("are named for pickup orders as ready / picked up", () => {
    expect(orderStatusLabel("shipped", "pickup")).toBe("Pronto para retirada");
    expect(orderStatusLabel("delivered", "pickup")).toBe("Retirado");
    expect(orderStatusLabel("shipped", "flat_rate")).toBe("Enviado");
    expect(orderStatusLabel("delivered", "flat_rate")).toBe("Entregue");
    expect(orderStatusLabel("processing", "pickup")).toBe("Em preparação");
  });
});
