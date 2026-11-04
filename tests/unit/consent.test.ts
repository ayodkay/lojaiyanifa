import { describe, expect, it } from "vitest";

import { CONSENT_VERSION, parseConsent } from "~/lib/consent";

describe("parseConsent", () => {
  it("reads a stored choice of the current version", () => {
    const raw = JSON.stringify({ analytics: false, marketing: true, decidedAt: "2026-11-04T10:00:00.000Z", version: CONSENT_VERSION });
    expect(parseConsent(raw)).toEqual({ analytics: false, marketing: true, decidedAt: "2026-11-04T10:00:00.000Z", version: CONSENT_VERSION });
  });

  it("asks again for nothing stored, junk, a partial choice or an older version — never assumes consent", () => {
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("{nope")).toBeNull();
    expect(parseConsent(JSON.stringify({ analytics: true, decidedAt: "x", version: CONSENT_VERSION }))).toBeNull();
    expect(parseConsent(JSON.stringify({ analytics: true, marketing: true, decidedAt: "x", version: CONSENT_VERSION - 1 }))).toBeNull();
    expect(parseConsent(JSON.stringify({ analytics: "yes", marketing: true, decidedAt: "x", version: CONSENT_VERSION }))).toBeNull();
  });
});
