import { beforeEach, describe, expect, it } from "vitest";

import { adminAuth, db } from "~/.server/firebase";

import { clearAuth, clearFirestore, emulatorHost, TEST_PROJECT } from "./emulators";

describe("Firebase Admin against the emulators", () => {
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  it("writes to the Firestore emulator (visible through the emulator's own REST API)", async () => {
    await db().doc("healthchecks/a").set({ ok: true });

    const res = await fetch(
      `http://${emulatorHost("FIRESTORE_EMULATOR_HOST")}/v1/projects/${TEST_PROJECT}/databases/(default)/documents/healthchecks/a`,
      { headers: { Authorization: "Bearer owner" } },
    );
    expect(res.status).toBe(200);
    expect((await res.json()).fields).toEqual({ ok: { booleanValue: true } });
    expect((await db().doc("healthchecks/a").get()).data()).toEqual({ ok: true });
  });

  it("never hands out the same counter value twice under concurrent transactions", async () => {
    const ref = db().doc("counters/test");
    await ref.set({ next: 1 });
    const take = () =>
      db().runTransaction(async (tx) => {
        const n = (await tx.get(ref)).get("next") as number;
        tx.update(ref, { next: n + 1 });
        return n;
      });

    const taken = await Promise.all(Array.from({ length: 10 }, take));

    expect(new Set(taken).size).toBe(10);
    expect([...taken].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect((await ref.get()).get("next")).toBe(11);
  });

  it("creates and reads users in the Auth emulator", async () => {
    const user = await adminAuth().createUser({ email: "cliente@example.com", password: "segredo123" });
    expect((await adminAuth().getUser(user.uid)).email).toBe("cliente@example.com");
  });
});
