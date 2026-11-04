// POST /api/reviews — a signed-in customer marks a published review as helpful or reports it.
// Body (JSON): { "id": "<review id>", "intent": "helpful" } | { "id", "intent": "report", "reason": "spam" | … }
// Answers: 200 { helpfulCount } / 200 { reported: true }; 401 signed out; 404 not published; 409 own review.
import { z } from "zod";

import { readCustomerSession } from "~/.server/customer-session";
import { reportReview, ReviewNotFoundError, ReviewVoteError, voteHelpful } from "~/.server/reviews";
import { NO_STORE } from "~/lib/http";
import { REPORT_REASONS } from "~/lib/reviews";

import type { Route } from "./+types/api.reviews";

const bodySchema = z.discriminatedUnion("intent", [
  z.object({ id: z.string().min(3).max(200), intent: z.literal("helpful") }),
  z.object({ id: z.string().min(3).max(200), intent: z.literal("report"), reason: z.enum(REPORT_REASONS) }),
]);

const json = (body: unknown, status = 200) => Response.json(body, { status, headers: NO_STORE });

export async function action({ request }: Route.ActionArgs) {
  if (request.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const session = await readCustomerSession(request);
  if (session.status !== "ok") return json({ error: "signed_out" }, 401);
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return json({ error: "invalid_json" }, 400);
  }
  const parsed = bodySchema.safeParse(payload);
  if (!parsed.success) return json({ error: "invalid_request" }, 400);
  try {
    if (parsed.data.intent === "helpful") return json({ helpfulCount: await voteHelpful(parsed.data.id, session.user) });
    await reportReview(parsed.data.id, session.user, parsed.data.reason);
    return json({ reported: true });
  } catch (error) {
    if (error instanceof ReviewNotFoundError) return json({ error: "not_found" }, 404);
    if (error instanceof ReviewVoteError) return json({ error: "own_review" }, 409);
    throw error;
  }
}
