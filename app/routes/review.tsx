// /products/:uid/review — write (or edit) a review of a product. Signed-in customers only; every review waits for
// moderation (app/.server/reviews.ts). Private: never cached, never indexed.
import { useEffect } from "react";
import { data, Form, Link, redirect, useNavigation } from "react-router";

import { ACCOUNT_HEADERS } from "~/.server/account-guard";
import { readCustomerSession } from "~/.server/customer-session";
import { getCustomerProfile } from "~/.server/customers";
import { getContent } from "~/.server/prismic";
import { getCustomerReview, hasBought, submitReview } from "~/.server/reviews";
import { Field, focusFirstError } from "~/components/form";
import { Breadcrumbs, Button, cx, Notice } from "~/components/ui";
import { fieldErrors } from "~/lib/account";
import { REVIEW_STATUS_LABEL, reviewFormToObject, reviewSchema, suggestedDisplayName } from "~/lib/reviews";

import type { Route } from "./+types/review";

async function context(request: Request, uid: string) {
  const session = await readCustomerSession(request);
  if (session.status !== "ok") throw redirect(`/login?redirectTo=${encodeURIComponent(`/products/${uid}/review`)}`, { headers: ACCOUNT_HEADERS });
  const { catalog } = await getContent();
  const product = catalog.productsByUid.get(uid);
  if (!product) throw data("Produto não encontrado.", { status: 404, headers: ACCOUNT_HEADERS });
  return { user: session.user, product };
}

export async function loader({ request, params }: Route.LoaderArgs) {
  const { user, product } = await context(request, params.uid);
  const [existing, profile, bought] = await Promise.all([getCustomerReview(user, product.id), getCustomerProfile(user.uid), hasBought(user, product.id)]);
  return data(
    { product: { uid: product.uid, name: product.name }, existing, suggestedName: suggestedDisplayName(profile?.name), bought },
    { headers: ACCOUNT_HEADERS },
  );
}

export async function action({ request, params }: Route.ActionArgs) {
  const { user, product } = await context(request, params.uid);
  const parsed = reviewSchema.safeParse(reviewFormToObject(await request.formData()));
  if (!parsed.success) return data({ fieldErrors: fieldErrors(parsed.error), sent: false }, { status: 400, headers: ACCOUNT_HEADERS });
  await submitReview(user, product.id, parsed.data);
  return data({ fieldErrors: {} as Record<string, string>, sent: true }, { headers: ACCOUNT_HEADERS });
}

export const headers = () => ACCOUNT_HEADERS;

export const meta = () => [{ title: "Avaliar produto | Loja Iyanifa" }, { name: "robots", content: "noindex, nofollow" }];

export default function ReviewPage({ loaderData, actionData }: Route.ComponentProps) {
  const { product, existing, suggestedName, bought } = loaderData;
  const navigation = useNavigation();
  const errors = actionData?.fieldErrors ?? {};
  useEffect(() => {
    if (actionData && !actionData.sent) focusFirstError();
  }, [actionData]);

  return (
    <div className="mx-auto max-w-2xl px-4 py-10 md:px-8">
      <Breadcrumbs
        items={[
          { name: "Início", href: "/" },
          { name: product.name, href: `/products/${product.uid}` },
          { name: "Avaliar", href: `/products/${product.uid}/review` },
        ]}
      />
      <h1 className="mt-8 text-4xl">Avaliar {product.name}</h1>
      {actionData?.sent ? (
        <div role="status" className="mt-8 space-y-4">
          <Notice tone="success">Obrigado! A sua avaliação foi enviada e aparece na página do produto depois da moderação.</Notice>
          <Link to={`/products/${product.uid}`} className="inline-block underline underline-offset-4">
            Voltar para o produto
          </Link>
        </div>
      ) : (
        <>
          <p className="mt-3 text-muted">
            Conte como foi a sua experiência com o produto. Todas as avaliações passam por moderação; não deixamos de publicar uma avaliação por ela ser
            negativa.
            {bought && " A sua aparece com o selo “Compra verificada”."}
          </p>
          {existing && (
            <div className="mt-6">
              <Notice tone={existing.status === "rejected" ? "warning" : "info"}>
                Você já avaliou este produto ({REVIEW_STATUS_LABEL[existing.status].toLowerCase()}
                {existing.rejectReason ? `: ${existing.rejectReason}` : ""}). Ao enviar de novo, a avaliação volta para a moderação.
              </Notice>
            </div>
          )}
          <Form method="post" noValidate className="mt-8 space-y-5">
            <fieldset aria-describedby={errors.rating ? "f-rating-erro" : undefined}>
              <legend className="mb-2 text-sm">Nota</legend>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5].map((n) => (
                  <label
                    key={n}
                    className="flex min-h-11 cursor-pointer items-center gap-1 rounded-[var(--radius-control)] border border-line-strong px-4 has-[:checked]:border-ink has-[:checked]:bg-ink has-[:checked]:text-paper has-[:focus-visible]:outline has-[:focus-visible]:outline-2"
                  >
                    <input type="radio" name="rating" value={n} defaultChecked={existing?.rating === n} className="sr-only" />
                    {n} <span aria-hidden="true">★</span>
                    <span className="sr-only">{n === 1 ? "estrela" : "estrelas"}</span>
                  </label>
                ))}
              </div>
              <p className="mt-1 text-xs text-muted">1 = muito ruim, 5 = excelente.</p>
              {errors.rating && (
                <p id="f-rating-erro" className="mt-1 text-sm text-danger">
                  {errors.rating}
                </p>
              )}
            </fieldset>
            <Field name="title" label="Título (opcional)" defaultValue={existing?.title ?? ""} error={errors.title} />
            <div>
              <label htmlFor="f-text" className="mb-1 block text-sm">
                A sua avaliação
              </label>
              <textarea
                id="f-text"
                name="text"
                rows={6}
                maxLength={2000}
                defaultValue={existing?.text ?? ""}
                aria-invalid={errors.text ? true : undefined}
                className={cx("w-full rounded-xl border bg-paper p-3", errors.text ? "border-danger" : "border-line-strong")}
              />
              {errors.text && <p className="mt-1 text-sm text-danger">{errors.text}</p>}
            </div>
            <Field name="displayName" label="Nome que aparece na avaliação" defaultValue={existing?.displayName ?? suggestedName} error={errors.displayName} hint="Ex.: Maria S. Não use o nome completo de outras pessoas." />
            <Field name="videoUrl" label="Vídeo do YouTube ou do Vimeo (opcional)" type="url" defaultValue={existing?.videoUrl ?? ""} error={errors.videoUrl} />
            <p className="text-xs text-muted">
              Ao enviar, você autoriza a exibição da avaliação no site, com o nome escolhido (veja os{" "}
              <Link to="/terms" className="underline underline-offset-4">
                termos de uso
              </Link>
              ). Você pode pedir a remoção quando quiser.
            </p>
            <Button type="submit" disabled={navigation.state !== "idle"}>
              {navigation.state === "submitting" ? "Enviando…" : "Enviar avaliação"}
            </Button>
          </Form>
        </>
      )}
    </div>
  );
}
