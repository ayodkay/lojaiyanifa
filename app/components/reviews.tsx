// The reviews section of a product page: average and distribution, the approved reviews (sorted in the browser),
// "útil" votes and reports (POST /api/reviews), and the link to write one. Rendered on the server from the product
// page's loader (cached publicly ≤ 60 s), so search engines see the reviews too.
import { useState } from "react";
import { Link } from "react-router";

import { averageRating, type PublicReview, type RatingStats, REPORT_REASON_LABEL, REPORT_REASONS, type ReportReason, REVIEW_SORT_LABEL, REVIEW_SORTS, type ReviewSort, sortReviews } from "~/lib/reviews";

import { cx } from "./ui";

const PAGE = 5;
const date = new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" });
const decimal = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });

export function Stars({ value, className }: { value: number; className?: string }) {
  const rounded = Math.round(value);
  return (
    <span className={cx("inline-flex text-ink", className)} role="img" aria-label={`${decimal.format(value)} de 5 estrelas`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <span key={n} aria-hidden="true" className={n <= rounded ? undefined : "text-line-strong"}>
          ★
        </span>
      ))}
    </span>
  );
}

type Feedback = { kind: "ok" | "error"; text: string; login?: boolean };

async function post(body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const res = await fetch("/api/reviews", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

function ReviewItem({ review, productUid }: { review: PublicReview; productUid: string }) {
  const [helpful, setHelpful] = useState(review.helpfulCount);
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason>("offensive");

  const fail = (status: number) =>
    status === 401
      ? setFeedback({ kind: "error", text: "Entre na sua conta para fazer isso.", login: true })
      : status === 409
        ? setFeedback({ kind: "error", text: "Você não pode votar na sua própria avaliação." })
        : setFeedback({ kind: "error", text: "Não foi possível agora. Tente de novo." });

  const vote = async () => {
    const { status, data } = await post({ id: review.id, intent: "helpful" });
    if (status === 200 && typeof data.helpfulCount === "number") {
      setHelpful(data.helpfulCount);
      setFeedback({ kind: "ok", text: "Obrigado pelo voto." });
    } else fail(status);
  };
  const report = async () => {
    const { status } = await post({ id: review.id, intent: "report", reason });
    if (status === 200) {
      setReporting(false);
      setFeedback({ kind: "ok", text: "Recebemos a denúncia; a moderação vai analisar." });
    } else fail(status);
  };

  return (
    <li className="border-t border-line py-6">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Stars value={review.rating} />
        {review.title && <h3 className="font-medium">{review.title}</h3>}
      </div>
      <p className="mt-1 text-sm text-muted">
        {review.authorName} · {date.format(new Date(review.createdAt))}
        {review.verifiedPurchase && <span className="ml-2 rounded-full bg-surface px-2 py-0.5 text-xs text-success">Compra verificada</span>}
      </p>
      <p className="mt-3 whitespace-pre-wrap break-words">{review.text}</p>
      {review.video && (
        <div className="mt-4 aspect-video max-w-md">
          <iframe
            src={review.video.src}
            title={review.video.title}
            loading="lazy"
            allow="encrypted-media; picture-in-picture"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
            className="h-full w-full border-0"
          />
        </div>
      )}
      {review.storeReply && (
        <div className="mt-4 border-l-2 border-line pl-4 text-sm">
          <p className="font-medium">Resposta da loja</p>
          <p className="mt-1 whitespace-pre-wrap text-ink-soft">{review.storeReply}</p>
        </div>
      )}
      <div className="mt-4 flex flex-wrap items-center gap-4 text-sm">
        <button type="button" onClick={vote} className="underline underline-offset-4">
          Útil ({helpful})
        </button>
        {reporting ? (
          <span className="flex flex-wrap items-center gap-2">
            <label htmlFor={`motivo-${review.id}`} className="sr-only">
              Motivo da denúncia
            </label>
            <select id={`motivo-${review.id}`} value={reason} onChange={(e) => setReason(e.target.value as ReportReason)} className="rounded border border-line-strong bg-paper px-2 py-1">
              {REPORT_REASONS.map((r) => (
                <option key={r} value={r}>
                  {REPORT_REASON_LABEL[r]}
                </option>
              ))}
            </select>
            <button type="button" onClick={report} className="underline underline-offset-4">
              Enviar denúncia
            </button>
            <button type="button" onClick={() => setReporting(false)} className="text-muted underline underline-offset-4">
              Cancelar
            </button>
          </span>
        ) : (
          <button type="button" onClick={() => setReporting(true)} className="text-muted underline underline-offset-4">
            Denunciar
          </button>
        )}
      </div>
      {feedback && (
        <p role="status" className={cx("mt-2 text-sm", feedback.kind === "error" ? "text-danger" : "text-success")}>
          {feedback.text}{" "}
          {feedback.login && (
            <Link to={`/login?redirectTo=${encodeURIComponent(`/products/${productUid}`)}`} className="underline underline-offset-4">
              Entrar
            </Link>
          )}
        </p>
      )}
    </li>
  );
}

export function ReviewsSection({ productUid, stats, reviews }: { productUid: string; stats: RatingStats | null; reviews: PublicReview[] | null }) {
  const [sort, setSort] = useState<ReviewSort>("helpful");
  const [shown, setShown] = useState(PAGE);
  const average = stats ? averageRating(stats) : null;
  const sorted = reviews ? sortReviews(reviews, sort) : [];

  return (
    <section aria-labelledby="avaliacoes" className="mt-20">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h2 id="avaliacoes" className="text-3xl">
          Avaliações
        </h2>
        <Link to={`/products/${productUid}/review`} className="text-sm underline underline-offset-4">
          Escrever uma avaliação
        </Link>
      </div>
      {stats === null || reviews === null ? (
        <p className="mt-4 text-muted">As avaliações estão indisponíveis no momento.</p>
      ) : average === null ? (
        <p className="mt-4 text-muted">Este produto ainda não tem avaliações. Comprou? Conte para os próximos clientes.</p>
      ) : (
        <div className="mt-6 grid gap-10 md:grid-cols-[16rem_1fr]">
          <div>
            <p className="font-display text-5xl">{decimal.format(average)}</p>
            <Stars value={average} className="mt-1 text-xl" />
            <p className="mt-1 text-sm text-muted">
              {stats.count} avaliaç{stats.count === 1 ? "ão" : "ões"}
            </p>
            <ul className="mt-4 space-y-1 text-sm" aria-label="Distribuição das notas">
              {[5, 4, 3, 2, 1].map((n) => {
                const count = stats.distribution[n - 1]!;
                return (
                  <li key={n} className="flex items-center gap-2">
                    <span className="w-8 shrink-0">{n} ★</span>
                    <span aria-hidden="true" className="h-2 flex-1 overflow-hidden rounded-full bg-line">
                      <span className="block h-full bg-ink" style={{ width: `${(count / stats.count) * 100}%` }} />
                    </span>
                    <span className="w-6 shrink-0 text-right text-muted">{count}</span>
                  </li>
                );
              })}
            </ul>
          </div>
          <div>
            <div className="flex items-center gap-2 text-sm">
              <label htmlFor="ordem-avaliacoes">Ordenar por</label>
              <select id="ordem-avaliacoes" value={sort} onChange={(e) => setSort(e.target.value as ReviewSort)} className="rounded border border-line-strong bg-paper px-2 py-1">
                {REVIEW_SORTS.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_SORT_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            <ul className="mt-4">
              {sorted.slice(0, shown).map((r) => (
                <ReviewItem key={r.id} review={r} productUid={productUid} />
              ))}
            </ul>
            {sorted.length > shown && (
              <button type="button" onClick={() => setShown((n) => n + PAGE)} className="mt-4 text-sm underline underline-offset-4">
                Ver mais avaliações ({sorted.length - shown})
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
