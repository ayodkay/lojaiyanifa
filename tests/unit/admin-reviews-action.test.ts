// The review moderation action (app/routes/admin.reviews.tsx) after Aprovar, Recusar, Excluir or Responder. Those
// buttons sit in React Router <Form>s, so the post goes to /admin/reviews.data, and React Router 8 gives the action
// that raw request together with `url`, the page's own address. The action redirected to request.url's path, so after
// each moderation the browser was sent to /admin/reviews.data… (2026-11-06).
import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

const moderateReview = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock("~/.server/reviews", () => ({
  moderateReview,
  countReviews: vi.fn(),
  listReviewsForAdmin: vi.fn(),
  ReviewNotFoundError: class ReviewNotFoundError extends Error {},
}));
vi.mock("~/.server/prismic", () => ({ getContent: vi.fn() }));
vi.mock("~/.server/session", () => ({ readAdminSession: vi.fn(), expiredSessionCookie: vi.fn() }));

const { action } = await import("~/routes/admin.reviews");
const { adminUserContext } = await import("~/.server/admin-guard");

/** What React Router 8 passes the action when a <Form method="post"> on `path` is sent: a POST to its .data URL, and `url`. */
function submitOn(path: string, fields: Record<string, string>): Parameters<typeof action>[0] {
  const url = new URL(path, "http://localhost");
  const dataUrl = new URL(url);
  dataUrl.pathname += ".data";
  const context = new RouterContextProvider();
  context.set(adminUserContext, { uid: "u1", email: "dono@example.com", role: "owner" });
  return { request: new Request(dataUrl, { method: "POST", body: new URLSearchParams(fields) }), url, params: {}, context, pattern: "" };
}

describe("a moderation sent from the reviews page", () => {
  it("goes back to the same list, at the page's own address", async () => {
    const response = await action(submitOn("/admin/reviews?status=reported", { intent: "approve", id: "r1" }));
    expect(moderateReview).toHaveBeenCalledOnce();
    expect(response).toBeInstanceOf(Response);
    expect((response as Response).headers.get("Location")).toBe("/admin/reviews?status=reported");
  });
});
