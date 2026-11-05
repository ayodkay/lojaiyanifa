// Product reviews (docs/architecture.md §4.2): `reviews/{productId}_{uid}` — one per customer and product — with
// `votes/{uid}` and `reports/{uid}`, and `productStats/{productId}` (count, sum, distribution of APPROVED reviews).
//
// Nothing is published before moderation: a new or edited review is "pending" until the owner or an admin approves
// it. Stats change in the same transaction as the status, so the average always matches what is shown.
// "Compra verificada": the customer has a paid order with the product (placed signed in, or with the account's
// verified e-mail), checked when the review is sent.
import { type DocumentData, Timestamp, type Transaction } from "firebase-admin/firestore";

import { videoFromEmbedUrl } from "~/lib/catalog/map";
import { applyRating, EMPTY_STATS, PAID_STATUSES, type PublicReview, type RatingStats, type ReportReason, type ReviewInput, type ReviewStatus } from "~/lib/reviews";

import { type CustomerActor, writeAuditInTransaction } from "./audit";
import type { CustomerUser } from "./customer-session";
import { db } from "./firebase";
import { iso } from "./order-doc";
import { ownsOrder } from "./ownership";
import type { AdminUser } from "./session";

const reviews = () => db().collection("reviews");
export const reviewId = (productId: string, uid: string) => `${productId}_${uid}`;
const statsRef = (productId: string) => db().collection("productStats").doc(productId);
const MAX_PER_PRODUCT = 200;

export class ReviewNotFoundError extends Error {
  override name = "ReviewNotFoundError";
}

export class ReviewVoteError extends Error {
  override name = "ReviewVoteError";
}

function statsOf(d: DocumentData | undefined): RatingStats {
  if (!d) return EMPTY_STATS;
  const distribution = d.distribution;
  if (!Number.isInteger(d.count) || !Number.isInteger(d.sum) || !Array.isArray(distribution) || distribution.length !== 5) {
    throw new Error(`productStats is corrupt: ${JSON.stringify(d)}`);
  }
  return { count: d.count, sum: d.sum, distribution: distribution as RatingStats["distribution"] };
}

const toPublic = (id: string, d: DocumentData): PublicReview => ({
  id,
  rating: d.rating,
  title: d.title ?? null,
  text: d.text,
  authorName: d.displayName,
  verifiedPurchase: d.verifiedPurchase === true,
  createdAt: iso(d.createdAt),
  helpfulCount: d.helpfulCount ?? 0,
  video: d.videoUrl ? videoFromEmbedUrl(d.videoUrl, `Vídeo de ${d.displayName}`) : null,
  storeReply: d.storeReply ?? null,
});

/** Approved reviews of a product and its stats, for the product page (sorted by the caller). Equality queries: no index. */
export async function listProductReviews(productId: string): Promise<{ stats: RatingStats; reviews: PublicReview[] }> {
  const [stats, snap] = await Promise.all([statsRef(productId).get(), reviews().where("productId", "==", productId).where("status", "==", "approved").limit(MAX_PER_PRODUCT).get()]);
  return { stats: statsOf(stats.data()), reviews: snap.docs.map((d) => toPublic(d.id, d.data())) };
}

/** Whether the customer paid for this product (placed signed in, or with their verified e-mail). */
export async function hasBought(user: CustomerUser, productId: string): Promise<boolean> {
  const orders = db().collection("orders");
  const [byUid, byEmail] = await Promise.all([
    orders.where("customer.uid", "==", user.uid).limit(200).get(),
    user.emailVerified ? orders.where("customer.email", "==", user.email).limit(200).get() : null,
  ]);
  return [...byUid.docs, ...(byEmail?.docs ?? [])].some((doc) => {
    const d = doc.data();
    return ownsOrder(user, d) && (PAID_STATUSES as readonly string[]).includes(d.status) && (d.lines as { productId: string }[]).some((l) => l.productId === productId);
  });
}

export interface CustomerReview {
  rating: number;
  title: string | null;
  text: string;
  displayName: string;
  videoUrl: string | null;
  status: ReviewStatus;
  rejectReason: string | null;
}

export async function getCustomerReview(user: CustomerUser, productId: string): Promise<CustomerReview | null> {
  const d = (await reviews().doc(reviewId(productId, user.uid)).get()).data();
  return d ? { rating: d.rating, title: d.title ?? null, text: d.text, displayName: d.displayName, videoUrl: d.videoUrl ?? null, status: d.status, rejectReason: d.rejectReason ?? null } : null;
}

/** A customer sends (or edits) their review: it waits for moderation; an approved one leaves the stats until approved again. */
export async function submitReview(user: CustomerUser, productId: string, input: ReviewInput, now = new Date()): Promise<{ verifiedPurchase: boolean }> {
  const verifiedPurchase = await hasBought(user, productId);
  await db().runTransaction(async (tx) => {
    const ref = reviews().doc(reviewId(productId, user.uid));
    const [existing, stats] = await tx.getAll(ref, statsRef(productId));
    const ts = Timestamp.fromDate(now);
    const fields = {
      productId,
      uid: user.uid,
      rating: input.rating,
      title: input.title,
      text: input.text,
      displayName: input.displayName,
      videoUrl: input.videoUrl,
      verifiedPurchase,
      status: "pending" satisfies ReviewStatus,
      rejectReason: null,
      updatedAt: ts,
    };
    if (existing!.exists) {
      if (existing!.get("status") === "approved") tx.set(statsRef(productId), applyRating(statsOf(stats!.data()), existing!.get("rating"), -1));
      tx.update(ref, fields);
    } else {
      tx.create(ref, { ...fields, helpfulCount: 0, reportCount: 0, storeReply: null, createdAt: ts });
    }
  });
  return { verifiedPurchase };
}

function moderateInTransaction(tx: Transaction, review: DocumentData, stats: DocumentData | undefined, next: ReviewStatus | "deleted") {
  const was = review.status as ReviewStatus;
  let s = statsOf(stats);
  if (was === "approved" && next !== "approved") s = applyRating(s, review.rating, -1);
  if (was !== "approved" && next === "approved") s = applyRating(s, review.rating, 1);
  if (was !== next && (was === "approved" || next === "approved")) tx.set(statsRef(review.productId), s);
}

export type Moderation = { action: "approve" } | { action: "reject"; reason: string } | { action: "delete" } | { action: "reply"; text: string | null };

/** The owner or an admin approves, rejects, deletes or answers a review (audited; stats updated in the same transaction). */
export async function moderateReview(id: string, moderation: Moderation, actor: AdminUser, now = new Date()): Promise<void> {
  await db().runTransaction(async (tx) => {
    const ref = reviews().doc(id);
    const snap = await tx.get(ref);
    if (!snap.exists) throw new ReviewNotFoundError(`reviews/${id} does not exist`);
    const review = snap.data()!;
    const stats = (await tx.get(statsRef(review.productId))).data();
    const ts = Timestamp.fromDate(now);
    const target = `reviews/${id}`;
    switch (moderation.action) {
      case "approve":
        moderateInTransaction(tx, review, stats, "approved");
        tx.update(ref, { status: "approved", rejectReason: null, approvedAt: ts, updatedAt: ts, moderatedBy: { uid: actor.uid, email: actor.email } });
        writeAuditInTransaction(tx, { action: "review.approved", actor, target }, now);
        break;
      case "reject":
        moderateInTransaction(tx, review, stats, "rejected");
        tx.update(ref, { status: "rejected", rejectReason: moderation.reason, updatedAt: ts, moderatedBy: { uid: actor.uid, email: actor.email } });
        writeAuditInTransaction(tx, { action: "review.rejected", actor, target, details: { reason: moderation.reason } }, now);
        break;
      case "delete":
        moderateInTransaction(tx, review, stats, "deleted");
        tx.delete(ref);
        writeAuditInTransaction(tx, { action: "review.deleted", actor, target }, now);
        break;
      case "reply":
        tx.update(ref, { storeReply: moderation.text, updatedAt: ts });
        writeAuditInTransaction(tx, { action: "review.replied", actor, target }, now);
        break;
    }
  });
}

/** "Esta avaliação foi útil": once per customer, never on their own review. Returns the new count. */
export async function voteHelpful(id: string, user: CustomerUser): Promise<number> {
  return db().runTransaction(async (tx) => {
    const ref = reviews().doc(id);
    const voteRef = ref.collection("votes").doc(user.uid);
    const [review, vote] = await tx.getAll(ref, voteRef);
    if (!review!.exists || review!.get("status") !== "approved") throw new ReviewNotFoundError(`reviews/${id} is not published`);
    if (review!.get("uid") === user.uid) throw new ReviewVoteError("own review");
    const count = (review!.get("helpfulCount") as number | undefined) ?? 0;
    if (vote!.exists) return count;
    tx.create(voteRef, { at: Timestamp.now() });
    tx.update(ref, { helpfulCount: count + 1 });
    return count + 1;
  });
}

/** Reports a review to the moderators (once per customer). Reported reviews are listed apart in the admin. */
export async function reportReview(id: string, user: CustomerUser, reason: ReportReason): Promise<void> {
  await db().runTransaction(async (tx) => {
    const ref = reviews().doc(id);
    const reportRef = ref.collection("reports").doc(user.uid);
    const [review, report] = await tx.getAll(ref, reportRef);
    if (!review!.exists || review!.get("status") !== "approved") throw new ReviewNotFoundError(`reviews/${id} is not published`);
    if (report!.exists) return;
    tx.create(reportRef, { at: Timestamp.now(), reason });
    tx.update(ref, { reportCount: ((review!.get("reportCount") as number | undefined) ?? 0) + 1 });
  });
}

// --- admin -----------------------------------------------------------------------------------------

export type ReviewFilter = ReviewStatus | "reported";

export interface AdminReview extends PublicReview {
  productId: string;
  uid: string;
  status: ReviewStatus;
  rejectReason: string | null;
  reportCount: number;
  videoUrl: string | null;
}

export async function listReviewsForAdmin(filter: ReviewFilter): Promise<AdminReview[]> {
  const query = filter === "reported" ? reviews().where("reportCount", ">", 0) : reviews().where("status", "==", filter);
  const snap = await query.limit(200).get();
  return snap.docs
    .map((d) => ({
      ...toPublic(d.id, d.data()),
      productId: d.get("productId") as string,
      uid: d.get("uid") as string,
      status: d.get("status") as ReviewStatus,
      rejectReason: (d.get("rejectReason") as string | null) ?? null,
      reportCount: (d.get("reportCount") as number | undefined) ?? 0,
      videoUrl: (d.get("videoUrl") as string | null) ?? null,
    }))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function countReviews(): Promise<Record<ReviewFilter, number>> {
  const [pending, approved, rejected, reported] = await Promise.all([
    reviews().where("status", "==", "pending").count().get(),
    reviews().where("status", "==", "approved").count().get(),
    reviews().where("status", "==", "rejected").count().get(),
    reviews().where("reportCount", ">", 0).count().get(),
  ]);
  return { pending: pending.data().count, approved: approved.data().count, rejected: rejected.data().count, reported: reported.data().count };
}

// --- account deletion and data export ---------------------------------------------------------------

export async function customerReviews(uid: string): Promise<DocumentData[]> {
  return (await reviews().where("uid", "==", uid).limit(500).get()).docs.map((d) => ({ id: d.id, ...d.data() }));
}

/** Deletes every review of a customer (their account is being deleted), taking approved ones out of the stats. */
export async function deleteCustomerReviews(uid: string, now = new Date()): Promise<number> {
  const snap = await reviews().where("uid", "==", uid).limit(500).get();
  const actor: CustomerActor = { type: "customer", name: uid };
  for (const doc of snap.docs) {
    await db().runTransaction(async (tx) => {
      const fresh = await tx.get(doc.ref);
      if (!fresh.exists) return;
      const review = fresh.data()!;
      const stats = (await tx.get(statsRef(review.productId))).data();
      moderateInTransaction(tx, review, stats, "deleted");
      tx.delete(doc.ref);
      writeAuditInTransaction(tx, { action: "review.deleted", actor, target: `reviews/${doc.id}` }, now);
    });
  }
  return snap.size;
}
