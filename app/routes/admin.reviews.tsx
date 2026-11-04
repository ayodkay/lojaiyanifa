// /admin/reviews — review moderation: nothing customers write is published before someone approves it here.
// Approve, reject (the customer sees the reason when editing), delete, or answer publicly. Reported reviews have their
// own tab. Every action is audited; the product's average changes in the same transaction (app/.server/reviews.ts).
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { ADMIN_HEADERS, adminUserContext, requireCapability } from "~/.server/admin-guard";
import { getContent } from "~/.server/prismic";
import { countReviews, listReviewsForAdmin, moderateReview, type ReviewFilter, ReviewNotFoundError } from "~/.server/reviews";
import { Stars } from "~/components/reviews";
import { Button, cx } from "~/components/ui";
import { adminDateTime } from "~/lib/admin/format";
import { adminMeta } from "~/lib/admin/meta";

import type { Route } from "./+types/admin.reviews";

const FILTERS: ReviewFilter[] = ["pending", "approved", "rejected", "reported"];
const FILTER_LABEL: Record<ReviewFilter, string> = { pending: "Aguardando", approved: "Publicadas", rejected: "Recusadas", reported: "Denunciadas" };
const parseFilter = (value: string | null): ReviewFilter => (FILTERS as string[]).includes(value ?? "") ? (value as ReviewFilter) : "pending";

export async function loader({ request, context }: Route.LoaderArgs) {
  requireCapability(context.get(adminUserContext), "reviews.moderate");
  const filter = parseFilter(new URL(request.url).searchParams.get("status"));
  const [reviews, counts, { catalog }] = await Promise.all([listReviewsForAdmin(filter), countReviews(), getContent()]);
  return {
    filter,
    counts,
    reviews: reviews.map((r) => {
      const product = catalog.productsById.get(r.productId);
      return { ...r, productName: product?.name ?? "(produto removido)", productUid: product?.uid ?? null };
    }),
  };
}

export async function action({ request, context }: Route.ActionArgs) {
  const user = context.get(adminUserContext);
  requireCapability(user, "reviews.moderate");
  const form = await request.formData();
  const id = String(form.get("id") ?? "");
  const intent = form.get("intent");
  const text = String(form.get("text") ?? "").trim();
  try {
    if (intent === "approve") await moderateReview(id, { action: "approve" }, user);
    else if (intent === "reject") await moderateReview(id, { action: "reject", reason: text.slice(0, 300) || "Fora das regras de publicação" }, user);
    else if (intent === "delete") await moderateReview(id, { action: "delete" }, user);
    else if (intent === "reply") await moderateReview(id, { action: "reply", text: text ? text.slice(0, 2000) : null }, user);
    else return data({ error: "Ação desconhecida." }, { status: 400, headers: ADMIN_HEADERS });
  } catch (error) {
    if (error instanceof ReviewNotFoundError) return data({ error: "Esta avaliação não existe mais." }, { status: 404, headers: ADMIN_HEADERS });
    throw error;
  }
  return redirect(new URL(request.url).pathname + new URL(request.url).search, { headers: ADMIN_HEADERS });
}

export const meta = () => adminMeta("Avaliações");

export default function AdminReviews({ loaderData, actionData }: Route.ComponentProps) {
  const { filter, counts, reviews } = loaderData;
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return (
    <div className="space-y-6">
      <h1 className="text-3xl md:text-4xl">Avaliações</h1>
      <nav aria-label="Filtrar avaliações">
        <ul className="flex flex-wrap gap-2">
          {FILTERS.map((f) => (
            <li key={f}>
              <Link
                to={f === "pending" ? "/admin/reviews" : `/admin/reviews?status=${f}`}
                aria-current={f === filter ? "page" : undefined}
                className={cx("inline-flex min-h-11 items-center gap-2 rounded-[var(--radius-control)] border px-4 text-sm", f === filter ? "border-ink bg-ink text-paper" : "border-line bg-surface hover:border-ink")}
              >
                {FILTER_LABEL[f]}
                <span className={cx("tabular-nums", f === filter ? "text-paper/80" : "text-muted")}>{counts[f]}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
      {actionData?.error && <p className="text-danger">{actionData.error}</p>}
      {reviews.length === 0 ? (
        <p className="border border-line bg-surface px-4 py-8 text-center text-muted">Nenhuma avaliação em “{FILTER_LABEL[filter]}”.</p>
      ) : (
        <ul className="space-y-4">
          {reviews.map((r) => (
            <li key={r.id} className="space-y-3 border border-line bg-surface p-5">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="font-medium">
                  {r.productUid ? (
                    <Link to={`/products/${r.productUid}`} className="underline underline-offset-4" target="_blank" rel="noopener">
                      {r.productName}
                    </Link>
                  ) : (
                    r.productName
                  )}
                </p>
                <p className="text-sm text-muted">{adminDateTime.format(new Date(r.createdAt))}</p>
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Stars value={r.rating} />
                {r.title && <span className="font-medium">{r.title}</span>}
              </div>
              <p className="whitespace-pre-wrap break-words">{r.text}</p>
              <p className="text-sm text-muted">
                {r.authorName}
                {r.verifiedPurchase ? " · Compra verificada" : " · sem compra confirmada"}
                {r.videoUrl && (
                  <>
                    {" "}
                    ·{" "}
                    <a href={r.videoUrl} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      vídeo
                    </a>
                  </>
                )}
                {r.reportCount > 0 && <span className="text-danger"> · {r.reportCount} denúncia{r.reportCount === 1 ? "" : "s"}</span>}
                {r.status === "rejected" && r.rejectReason && <> · recusada: {r.rejectReason}</>}
              </p>
              {r.storeReply && <p className="border-l-2 border-line pl-3 text-sm">Resposta da loja: {r.storeReply}</p>}
              <div className="flex flex-wrap items-start gap-3">
                {r.status !== "approved" && (
                  <Form method="post">
                    <input type="hidden" name="id" value={r.id} />
                    <Button type="submit" name="intent" value="approve" disabled={busy}>
                      Publicar
                    </Button>
                  </Form>
                )}
                {r.status !== "rejected" && (
                  <Form method="post" className="flex flex-wrap gap-2">
                    <input type="hidden" name="id" value={r.id} />
                    <label htmlFor={`motivo-${r.id}`} className="sr-only">
                      Motivo da recusa
                    </label>
                    <input id={`motivo-${r.id}`} name="text" placeholder="Motivo (o cliente vê)" className="min-h-11 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 text-sm" />
                    <Button type="submit" name="intent" value="reject" variant="secondary" disabled={busy}>
                      Recusar
                    </Button>
                  </Form>
                )}
                <Form method="post">
                  <input type="hidden" name="id" value={r.id} />
                  <Button type="submit" name="intent" value="delete" variant="ghost" className="text-danger" disabled={busy}>
                    Excluir
                  </Button>
                </Form>
              </div>
              {r.status === "approved" && (
                <Form method="post" className="space-y-2">
                  <input type="hidden" name="id" value={r.id} />
                  <label htmlFor={`resposta-${r.id}`} className="block text-sm">
                    Resposta pública da loja (vazio apaga)
                  </label>
                  <textarea id={`resposta-${r.id}`} name="text" rows={2} defaultValue={r.storeReply ?? ""} className="w-full rounded-xl border border-line-strong bg-paper p-3 text-sm" />
                  <Button type="submit" name="intent" value="reply" variant="secondary" disabled={busy}>
                    Salvar resposta
                  </Button>
                </Form>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
