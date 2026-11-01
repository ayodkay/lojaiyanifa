import { beforeEach, describe, expect, it } from "vitest";

import { inventoryRef, skuDocId, stockLevels } from "~/.server/inventory";

import { clearFirestore } from "./emulators";

describe("stockLevels (Firestore inventory + Prismic seed)", () => {
  beforeEach(clearFirestore);

  it("is untracked when there's no document and no Prismic stock", async () => {
    const levels = await stockLevels(new Map([["A-1", null]]));
    expect(levels.get("A-1")).toEqual({ tracked: false });
  });

  it("uses the Prismic stock while no inventory document exists", async () => {
    const levels = await stockLevels(new Map([["A-1", 7], ["A-2", 0]]));
    expect(levels.get("A-1")).toEqual({ tracked: true, available: 7 });
    expect(levels.get("A-2")).toEqual({ tracked: true, available: 0 });
  });

  it("trusts Firestore over Prismic once the document exists: on hand minus reserved, never below 0", async () => {
    await inventoryRef("A-1").set({ sku: "A-1", onHand: 5, reserved: 2 });
    await inventoryRef("A-2").set({ sku: "A-2", onHand: 1, reserved: 3 });
    const levels = await stockLevels(new Map([["A-1", 50], ["A-2", null]]));
    expect(levels.get("A-1")).toEqual({ tracked: true, available: 3 });
    expect(levels.get("A-2")).toEqual({ tracked: true, available: 0 });
  });

  it("refuses corrupt counts instead of guessing", async () => {
    await inventoryRef("A-1").set({ sku: "A-1", onHand: "5", reserved: 0 });
    await expect(stockLevels(new Map([["A-1", null]]))).rejects.toThrow(/corrupt/);
  });

  it("stores SKUs containing '/' as one document, not a sub-path", async () => {
    expect(skuDocId("VES-001/M")).toBe("VES-001%2FM");
    expect(skuDocId("VES-001")).toBe("VES-001");
    await inventoryRef("VES-001/M").set({ sku: "VES-001/M", onHand: 4, reserved: 1 });
    expect((await stockLevels(new Map([["VES-001/M", null]]))).get("VES-001/M")).toEqual({ tracked: true, available: 3 });
    expect(() => skuDocId("..")).toThrow();
  });
});
