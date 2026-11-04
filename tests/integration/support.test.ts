// Support tickets against the Firestore emulator (app/.server/support.ts).
import { beforeEach, describe, expect, it } from "vitest";

import type { CustomerUser } from "~/.server/customer-session";
import { db } from "~/.server/firebase";
import type { AdminUser } from "~/.server/session";
import {
  countTickets,
  createTicket,
  getCustomerTicket,
  getTicket,
  listCustomerTickets,
  listTickets,
  RATE_LIMITS,
  RateLimitError,
  replyToTicket,
  setTicketStatus,
} from "~/.server/support";
import type { ContactInput } from "~/lib/support";

import { clearFirestore } from "./emulators";

const t0 = new Date("2026-11-04T12:00:00.000Z");
const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const question = (overrides: Partial<ContactInput> = {}): ContactInput => ({
  name: "Maria da Silva",
  email: "maria@exemplo.com",
  phone: null,
  orderNumber: null,
  topic: "order",
  message: "Quando chega o meu pedido?",
  returnReason: null,
  returnPreference: null,
  returnItems: null,
  ...overrides,
});

const mails = async () => (await db().collection("mail").get()).docs.map((d) => ({ template: d.get("template") as string, to: d.get("to") as string, data: d.get("data") as Record<string, unknown> }));

describe("createTicket", () => {
  beforeEach(clearFirestore);

  it("numbers tickets from 1001 and confirms each at once by e-mail, with a notice to the store", async () => {
    expect(await createTicket(question(), { now: t0, storeInbox: "loja@exemplo.com" })).toEqual({ number: 1001 });
    expect(await createTicket(question({ email: "joao@exemplo.com", name: "Joao Lima" }), { now: t0, storeInbox: "loja@exemplo.com" })).toEqual({ number: 1002 });
    const all = await mails();
    expect(all.filter((m) => m.template === "ticket_received").map((m) => [m.to, m.data.number]).sort()).toEqual([
      ["joao@exemplo.com", 1002],
      ["maria@exemplo.com", 1001],
    ]);
    expect(all.filter((m) => m.template === "store_new_ticket").every((m) => m.to === "loja@exemplo.com")).toBe(true);
    const ticket = await getTicket(1001);
    expect(ticket).toMatchObject({ number: 1001, status: "open", topic: "order", email: "maria@exemplo.com", customerUid: null, returnRequest: null });
    expect(ticket!.messages).toMatchObject([{ from: "customer", text: "Quando chega o meu pedido?" }]);
  });

  it("keeps a return request's details and tells a withdrawal apart in the confirmation", async () => {
    await createTicket(question({ topic: "returns", orderNumber: 1001, returnReason: "withdrawal", returnPreference: "refund", returnItems: "1 Colar" }), { now: t0 });
    expect((await getTicket(1001))!.returnRequest).toEqual({ reason: "withdrawal", preference: "refund", items: "1 Colar" });
    expect((await mails()).map((m) => [m.template, m.data.returnReason])).toEqual([["ticket_received", "withdrawal"]]);
  });

  it(`refuses the ${RATE_LIMITS.perEmail + 1}th message from one e-mail within the hour, but takes it the next hour`, async () => {
    for (let i = 0; i < RATE_LIMITS.perEmail; i++) await createTicket(question(), { now: t0 });
    await expect(createTicket(question(), { now: t0 })).rejects.toBeInstanceOf(RateLimitError);
    expect((await createTicket(question(), { now: new Date(t0.getTime() + 3_600_000) })).number).toBe(1001 + RATE_LIMITS.perEmail);
  });

  it("limits one IP across e-mails, and never stores the IP itself", async () => {
    for (let i = 0; i < RATE_LIMITS.perIp; i++) await createTicket(question({ email: `p${i}@exemplo.com` }), { now: t0, clientIp: "203.0.113.7" });
    await expect(createTicket(question({ email: "outra@exemplo.com" }), { now: t0, clientIp: "203.0.113.7" })).rejects.toBeInstanceOf(RateLimitError);
    expect((await createTicket(question({ email: "outra@exemplo.com" }), { now: t0, clientIp: "198.51.100.1" })).number).toBeGreaterThan(1000);
    const limits = await db().collection("rateLimits").get();
    expect(JSON.stringify(limits.docs.map((d) => [d.id, d.data()]))).not.toContain("203.0.113.7");
  });

  it("a refused message leaves nothing behind (no ticket, no e-mail, counter untouched)", async () => {
    for (let i = 0; i < RATE_LIMITS.perEmail; i++) await createTicket(question(), { now: t0 });
    const before = (await db().collection("mail").get()).size;
    await expect(createTicket(question(), { now: t0 })).rejects.toBeInstanceOf(RateLimitError);
    expect((await db().collection("mail").get()).size).toBe(before);
    expect((await db().doc("counters/tickets").get()).get("next")).toBe(1001 + RATE_LIMITS.perEmail);
  });
});

describe("the team's answers", () => {
  beforeEach(clearFirestore);

  it("a reply joins the thread, marks the ticket answered, e-mails the customer and is audited", async () => {
    await createTicket(question(), { now: t0 });
    await replyToTicket(1001, "  Chega amanhã!  ", owner, new Date(t0.getTime() + 60_000));
    const ticket = await getTicket(1001);
    expect(ticket!.status).toBe("answered");
    expect(ticket!.messages.map((m) => [m.from, m.text])).toEqual([
      ["customer", "Quando chega o meu pedido?"],
      ["store", "Chega amanhã!"],
    ]);
    expect((await mails()).filter((m) => m.template === "ticket_reply").map((m) => [m.to, m.data.reply])).toEqual([["maria@exemplo.com", "Chega amanhã!"]]);
    const audit = await db().collection("auditLogs").where("action", "==", "ticket.replied").get();
    expect(audit.size).toBe(1);
  });

  it("closes and reopens (each once, audited), and lists by status with counts", async () => {
    await createTicket(question(), { now: t0 });
    await createTicket(question({ email: "joao@exemplo.com" }), { now: t0 });
    await setTicketStatus(1001, "closed", owner);
    await setTicketStatus(1001, "closed", owner); // double click
    expect(await countTickets()).toEqual({ open: 1, answered: 0, closed: 1 });
    expect((await listTickets("open", null)).rows.map((r) => r.number)).toEqual([1002]);
    await setTicketStatus(1001, "open", owner);
    expect((await listTickets("open", null)).rows.map((r) => r.number)).toEqual([1002, 1001]);
    const actions = (await db().collection("auditLogs").get()).docs.map((d) => d.get("action")).sort();
    expect(actions).toEqual(["ticket.closed", "ticket.reopened"]);
  });
});

describe("the customer's tickets", () => {
  beforeEach(clearFirestore);

  it("sent signed in: always theirs; sent with their e-mail: only once it is verified; never another's", async () => {
    const maria: CustomerUser = { uid: "uid-maria", email: "maria@exemplo.com", emailVerified: false };
    await createTicket(question(), { now: t0, uid: "uid-maria" }); // 1001
    await createTicket(question(), { now: t0 }); // 1002, same e-mail, no login
    await createTicket(question({ email: "joao@exemplo.com" }), { now: t0 }); // 1003
    expect((await listCustomerTickets(maria)).map((t) => t.number)).toEqual([1001]);
    const verified = { ...maria, emailVerified: true };
    expect((await listCustomerTickets(verified)).map((t) => t.number)).toEqual([1002, 1001]);
    expect(await getCustomerTicket(verified, 1003)).toBeNull();
    expect((await getCustomerTicket(maria, 1001))?.number).toBe(1001);
  });
});
