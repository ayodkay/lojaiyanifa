import { describe, expect, it } from "vitest";

import { fieldErrors } from "~/lib/account";
import {
  applyRating,
  averageRating,
  EMPTY_STATS,
  parseReviewSort,
  type PublicReview,
  reviewFormToObject,
  reviewSchema,
  sortReviews,
  suggestedDisplayName,
} from "~/lib/reviews";

const form = (entries: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(entries)) f.set(k, v);
  return f;
};

describe("review form", () => {
  it("accepts a rating, an optional title and a YouTube or Vimeo link", () => {
    const parsed = reviewSchema.parse(reviewFormToObject(form({ rating: "5", title: "", text: "Peça linda, chegou rápido.", displayName: "Maria S.", videoUrl: "https://youtu.be/dQw4w9WgXcQ" })));
    expect(parsed).toEqual({ rating: 5, title: null, text: "Peça linda, chegou rápido.", displayName: "Maria S.", videoUrl: "https://youtu.be/dQw4w9WgXcQ" });
  });

  it("explains what's missing and refuses other video sites", () => {
    const result = reviewSchema.safeParse(reviewFormToObject(form({ rating: "0", text: "ok", displayName: "M", videoUrl: "https://evil.example/v" })));
    expect(Object.keys(fieldErrors(result.error!)).sort()).toEqual(["displayName", "rating", "text", "videoUrl"]);
  });

  it("suggests first name + last initial", () => {
    expect(suggestedDisplayName("Maria da Silva")).toBe("Maria S.");
    expect(suggestedDisplayName("Maria")).toBe("Maria");
    expect(suggestedDisplayName(null)).toBe("");
  });
});

describe("rating stats", () => {
  it("adds and removes ratings and averages with one decimal", () => {
    let stats = applyRating(EMPTY_STATS, 5, 1);
    stats = applyRating(stats, 4, 1);
    stats = applyRating(stats, 4, 1);
    expect(stats).toEqual({ count: 3, sum: 13, distribution: [0, 0, 0, 2, 1] });
    expect(averageRating(stats)).toBe(4.3);
    expect(averageRating(applyRating(stats, 5, -1))).toBe(4);
    expect(averageRating(EMPTY_STATS)).toBeNull();
  });

  it("refuses to go below zero or take a rating that isn't 1–5", () => {
    expect(() => applyRating(EMPTY_STATS, 3, -1)).toThrow(/negative/);
    expect(() => applyRating(EMPTY_STATS, 6, 1)).toThrow(/invalid rating/);
  });
});

describe("sortReviews", () => {
  const review = (id: string, rating: number, helpfulCount: number, createdAt: string): PublicReview => ({
    id, rating, helpfulCount, createdAt, title: null, text: "texto", authorName: "A", verifiedPurchase: false, video: null, storeReply: null,
  });
  const list = [review("a", 3, 0, "2026-11-01"), review("b", 5, 2, "2026-11-02"), review("c", 1, 2, "2026-11-03")];

  it("sorts by helpful (then newest), newest, highest and lowest", () => {
    expect(sortReviews(list, "helpful").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortReviews(list, "newest").map((r) => r.id)).toEqual(["c", "b", "a"]);
    expect(sortReviews(list, "highest").map((r) => r.id)).toEqual(["b", "a", "c"]);
    expect(sortReviews(list, "lowest").map((r) => r.id)).toEqual(["c", "a", "b"]);
    expect(parseReviewSort("x")).toBe("helpful");
  });
});
