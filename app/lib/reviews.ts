// Product reviews (docs/architecture.md §4.2 `reviews`, `productStats`): the form, sorting and the rating maths shared
// by the server, the product page and the admin. Texts are customer-facing (pt-BR).
import { z } from "zod";

import { videoFromEmbedUrl } from "~/lib/catalog/map";

export const REVIEW_STATUSES = ["pending", "approved", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = { pending: "Aguardando moderação", approved: "Publicada", rejected: "Recusada" };

export const REVIEW_SORTS = ["helpful", "newest", "highest", "lowest"] as const;
export type ReviewSort = (typeof REVIEW_SORTS)[number];
export const REVIEW_SORT_LABEL: Record<ReviewSort, string> = { helpful: "Mais úteis", newest: "Mais recentes", highest: "Maiores notas", lowest: "Menores notas" };
export const parseReviewSort = (value: unknown): ReviewSort => ((REVIEW_SORTS as readonly unknown[]).includes(value) ? (value as ReviewSort) : "helpful");

export const REPORT_REASONS = ["offensive", "spam", "personal_data", "not_about_product", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export const REPORT_REASON_LABEL: Record<ReportReason, string> = {
  offensive: "Conteúdo ofensivo ou discriminatório",
  spam: "Propaganda ou spam",
  personal_data: "Expõe dados pessoais",
  not_about_product: "Não fala do produto",
  other: "Outro motivo",
};

export const reviewSchema = z.object({
  rating: z.coerce.number({ error: "Escolha de 1 a 5 estrelas." }).int().min(1, "Escolha de 1 a 5 estrelas.").max(5, "Escolha de 1 a 5 estrelas."),
  title: z
    .string()
    .trim()
    .max(80, "Use no máximo 80 caracteres.")
    .transform((v) => v || null),
  text: z.string().trim().min(10, "Conte um pouco mais (pelo menos 10 caracteres).").max(2000, "Use no máximo 2000 caracteres."),
  displayName: z.string().trim().min(2, "Informe como quer aparecer (ex.: Maria S.).").max(40, "Use no máximo 40 caracteres."),
  videoUrl: z
    .string()
    .trim()
    .transform((value, ctx) => {
      if (!value) return null;
      if (!videoFromEmbedUrl(value, "")) {
        ctx.addIssue({ code: "custom", message: "Use um link do YouTube ou do Vimeo." });
        return z.NEVER;
      }
      return value;
    }),
});
export type ReviewInput = z.infer<typeof reviewSchema>;

export const reviewFormToObject = (form: FormData) => {
  const text = (k: string) => {
    const v = form.get(k);
    return typeof v === "string" ? v : "";
  };
  return { rating: text("rating"), title: text("title"), text: text("text"), displayName: text("displayName"), videoUrl: text("videoUrl") };
};

/** "Maria da Silva" → "Maria S." (the suggestion for the name shown with a review). */
export function suggestedDisplayName(fullName: string | null | undefined): string {
  const parts = (fullName ?? "").trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "";
  const last = parts.length > 1 ? parts.at(-1)! : "";
  return last ? `${parts[0]} ${last[0]!.toUpperCase()}.` : parts[0]!;
}

export interface RatingStats {
  count: number;
  sum: number;
  /** Reviews per star, index 0 = 1 star. */
  distribution: [number, number, number, number, number];
}

export const EMPTY_STATS: RatingStats = { count: 0, sum: 0, distribution: [0, 0, 0, 0, 0] };

/** Adds (+1) or removes (−1) one rating. Never below zero: corrupt stats fail loudly instead. */
export function applyRating(stats: RatingStats, rating: number, delta: 1 | -1): RatingStats {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw new Error(`invalid rating ${rating}`);
  const distribution = [...stats.distribution] as RatingStats["distribution"];
  distribution[rating - 1] = distribution[rating - 1]! + delta;
  const next = { count: stats.count + delta, sum: stats.sum + delta * rating, distribution };
  if (next.count < 0 || next.sum < 0 || distribution[rating - 1]! < 0) throw new Error(`rating stats would go negative: ${JSON.stringify(stats)} ${delta} × ${rating}`);
  return next;
}

/** Average with one decimal (4.5), or null without reviews. */
export const averageRating = (stats: RatingStats): number | null => (stats.count > 0 ? Math.round((stats.sum / stats.count) * 10) / 10 : null);

export interface PublicReview {
  id: string;
  rating: number;
  title: string | null;
  text: string;
  authorName: string;
  verifiedPurchase: boolean;
  createdAt: string;
  helpfulCount: number;
  video: { provider: "youtube" | "vimeo" | "file"; src: string; title: string } | null;
  storeReply: string | null;
}

export function sortReviews(reviews: PublicReview[], sort: ReviewSort): PublicReview[] {
  const newest = (a: PublicReview, b: PublicReview) => b.createdAt.localeCompare(a.createdAt);
  const byHelpful = (a: PublicReview, b: PublicReview) => b.helpfulCount - a.helpfulCount || newest(a, b);
  const comparators: Record<ReviewSort, (a: PublicReview, b: PublicReview) => number> = {
    helpful: byHelpful,
    newest,
    highest: (a, b) => b.rating - a.rating || newest(a, b),
    lowest: (a, b) => a.rating - b.rating || newest(a, b),
  };
  return [...reviews].sort(comparators[sort]);
}

/** Order statuses in which the customer has paid for the product (a verified purchase). */
export const PAID_STATUSES = ["paid", "processing", "shipped", "delivered", "partially_refunded"] as const;
