// Product reviews against the Firestore + Auth emulators (app/.server/reviews.ts).
import { randomUUID } from "node:crypto";

import { beforeEach, describe, expect, it } from "vitest";

import { confirmPixPayment } from "~/.server/admin-orders";
import type { CustomerUser } from "~/.server/customer-session";
import { deleteCustomerAccount } from "~/.server/customers";
import { adminAuth, db } from "~/.server/firebase";
import { createOrder, type OrderDeps } from "~/.server/orders";
import {
  countReviews,
  listProductReviews,
  listReviewsForAdmin,
  moderateReview,
  reportReview,
  reviewId,
  ReviewVoteError,
  submitReview,
  voteHelpful,
} from "~/.server/reviews";
import type { AdminUser } from "~/.server/session";
import type { ReviewInput } from "~/lib/reviews";
import { shippingSettingsSchema } from "~/lib/store-settings";

import { catalogOf, catalogProduct } from "../factories";

import { clearAuth, clearFirestore } from "./emulators";

const owner: AdminUser = { uid: "uid-dono", email: "dono@example.com", role: "owner" };
const maria: CustomerUser = { uid: "uid-maria", email: "maria@exemplo.com", emailVerified: true };
const joao: CustomerUser = { uid: "uid-joao", email: "joao@exemplo.com", emailVerified: true };
const review = (overrides: Partial<ReviewInput> = {}): ReviewInput => ({ rating: 5, title: null, text: "Peça linda, recomendo.", displayName: "Maria S.", videoUrl: null, ...overrides });
const deps: OrderDeps = {
  catalog: catalogOf([catalogProduct("colar", { name: "Colar", sku: "COLAR-1", priceCents: 10000, prismicStock: 50 })]),
  payment: { pix: { key: "123e4567-e12b-12d1-a456-426655440000", merchantName: "Loja Iyanifa", merchantCity: "Rio de Janeiro" }, expiryHours: 24 },
  shipping: shippingSettingsSchema.parse({ flatRate: { enabled: true, priceCents: 2500 }, pickup: { enabled: false, address: "x" } }),
};
const buy = (user: CustomerUser) =>
  createOrder(
    {
      idempotencyKey: randomUUID(), name: "Maria da Silva", email: user.email, phone: "+5521987654321", cpf: "52998224725", shippingMethod: "flat_rate",
      address: { cep: "21360201", street: "Rua A", number: "1", complement: null, neighborhood: "Madureira", city: "Rio de Janeiro", state: "RJ" },
      acceptTerms: true, couponCode: null, items: [{ productId: "colar", sku: "COLAR-1", quantity: 1 }],
    },
    deps,
    { uid: user.uid },
  );
const stats = async () => (await listProductReviews("colar")).stats;

describe("reviews", () => {
  beforeEach(async () => {
    await clearFirestore();
    await clearAuth();
  });

  it("nothing is published before approval; approving and rejecting move the stats", async () => {
    await submitReview(maria, "colar", review({ rating: 5 }));
    await submitReview(joao, "colar", review({ rating: 2, displayName: "Joao L." }));
    expect((await listProductReviews("colar")).reviews).toEqual([]);
    expect(await countReviews()).toMatchObject({ pending: 2, approved: 0 });

    await moderateReview(reviewId("colar", maria.uid), { action: "approve" }, owner);
    await moderateReview(reviewId("colar", joao.uid), { action: "approve" }, owner);
    expect(await stats()).toEqual({ count: 2, sum: 7, distribution: [0, 1, 0, 0, 1] });
    await moderateReview(reviewId("colar", joao.uid), { action: "reject", reason: "Fala de outro produto" }, owner);
    expect(await stats()).toEqual({ count: 1, sum: 5, distribution: [0, 0, 0, 0, 1] });
    expect((await listProductReviews("colar")).reviews.map((r) => r.authorName)).toEqual(["Maria S."]);
    const audit = (await db().collection("auditLogs").get()).docs.map((d) => d.get("action")).sort();
    expect(audit).toEqual(["review.approved", "review.approved", "review.rejected"]);
  });

  it("'compra verificada' only with a paid order of the product", async () => {
    await buy(maria);
    expect(await submitReview(maria, "colar", review())).toEqual({ verifiedPurchase: false }); // still waiting for the Pix
    await confirmPixPayment(1001, owner);
    expect(await submitReview(maria, "colar", review())).toEqual({ verifiedPurchase: true });
  });

  it("editing an approved review sends it back to moderation and out of the stats", async () => {
    await submitReview(maria, "colar", review({ rating: 5 }));
    await moderateReview(reviewId("colar", maria.uid), { action: "approve" }, owner);
    await submitReview(maria, "colar", review({ rating: 3, text: "Mudei de ideia sobre o tamanho." }));
    expect(await stats()).toEqual({ count: 0, sum: 0, distribution: [0, 0, 0, 0, 0] });
    expect(await countReviews()).toMatchObject({ pending: 1, approved: 0 });
  });

  it("helpful votes count once per customer and never on one's own review; reports reach the moderators", async () => {
    await submitReview(maria, "colar", review());
    const id = reviewId("colar", maria.uid);
    await moderateReview(id, { action: "approve" }, owner);
    expect(await voteHelpful(id, joao)).toBe(1);
    expect(await voteHelpful(id, joao)).toBe(1);
    await expect(voteHelpful(id, maria)).rejects.toBeInstanceOf(ReviewVoteError);
    await reportReview(id, joao, "spam");
    await reportReview(id, joao, "spam");
    expect((await listReviewsForAdmin("reported")).map((r) => [r.id, r.reportCount])).toEqual([[id, 1]]);
  });

  it("deleting the account deletes its reviews and takes them out of the stats", async () => {
    const { uid } = await adminAuth().createUser({ email: "ana@exemplo.com", password: "senha-de-teste-123", emailVerified: true });
    const ana: CustomerUser = { uid, email: "ana@exemplo.com", emailVerified: true };
    await submitReview(ana, "colar", review({ rating: 4, displayName: "Ana P." }));
    await moderateReview(reviewId("colar", uid), { action: "approve" }, owner);
    await deleteCustomerAccount(ana);
    expect(await stats()).toEqual({ count: 0, sum: 0, distribution: [0, 0, 0, 0, 0] });
    expect((await db().doc(`reviews/${reviewId("colar", uid)}`).get()).exists).toBe(false);
  });
});
