import { PrismicRichText } from "@prismicio/react";
import { useEffect } from "react";
import { data, Link, useFetcher } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { ChatIcon, PixIcon, ReturnIcon, ShieldIcon, SparkIcon, TruckIcon } from "~/components/icons";
import { ProductGrid } from "~/components/product-card";
import { ButtonLink, ProductImage, SectionHeading } from "~/components/ui";
import { sortProducts, toSummary, topLevelCategories, type ProductSummary } from "~/lib/catalog/query";
import type { CatalogCategory, CatalogProduct, PromoBanner } from "~/lib/catalog/types";
import { useRecentlyViewed } from "~/lib/client-store";
import { publicCacheUntil } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { categoryHref } from "~/lib/shell";
import { localBusinessJsonLd } from "~/lib/store-profile";

import type { Route } from "./+types/home";

function activeBanners(banners: PromoBanner[], now: number) {
  const active = banners.filter(
    (b) => (!b.startsAt || Date.parse(b.startsAt) <= now) && (!b.endsAt || Date.parse(b.endsAt) > now),
  );
  // Seconds until the next banner starts or ends, so caches never outlive a schedule.
  const boundaries = banners
    .flatMap((b) => [b.startsAt, b.endsAt])
    .map((t) => (t ? Date.parse(t) : Number.NaN))
    .filter((t) => Number.isFinite(t) && t > now);
  const next = boundaries.length ? (Math.min(...boundaries) - now) / 1000 : null;
  return { active, nextChangeSeconds: next };
}

export async function loader() {
  const { catalog, settings, homepage } = await getContent();
  const byIds = (ids: string[]) =>
    ids.map((id) => catalog.productsById.get(id)).filter((p): p is CatalogProduct => Boolean(p)).map(toSummary);
  const curatedCategories = (homepage?.featuredCategoryIds ?? [])
    .map((id) => catalog.categoriesById.get(id))
    .filter((c): c is CatalogCategory => Boolean(c));
  const categories = (curatedCategories.length ? curatedCategories : topLevelCategories(catalog)).slice(0, 6);
  const { active, nextChangeSeconds } = activeBanners(homepage?.banners ?? [], Date.now());

  const siteUrl = env().SITE_URL;
  const payload = {
    siteUrl,
    storeName: settings.storeName,
    localBusiness: localBusinessJsonLd(settings, siteUrl),
    tagline: settings.tagline,
    seo: homepage?.seo ?? settings.seo,
    hero: homepage?.hero ?? null,
    featured: byIds(homepage?.featuredProductIds ?? []),
    offers: catalog.products.filter((p) => p.discountPercent !== null && p.purchasable).slice(0, 8).map(toSummary),
    newArrivals: sortProducts(catalog.products, "newest").slice(0, 8).map(toSummary),
    categories: categories.map((c) => ({ id: c.id, title: c.title, href: categoryHref(c), image: c.image })),
    banners: active,
    benefits: homepage?.benefits ?? [],
    testimonials: homepage?.testimonials ?? [],
  };
  // Never cache longer than the next banner start/end.
  return data(payload, { headers: publicCacheUntil(nextChangeSeconds) });
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  const title = loaderData.seo.title ?? loaderData.storeName;
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: "/",
    title,
    description: loaderData.seo.description ?? loaderData.tagline,
    image: loaderData.seo.image ?? loaderData.hero?.image ?? null,
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "WebSite",
        name: loaderData.storeName,
        url: loaderData.siteUrl,
        potentialAction: {
          "@type": "SearchAction",
          target: `${loaderData.siteUrl}/search?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      // A LocalBusiness is an Organization: one block describes the store, not two.
      loaderData.localBusiness,
    ],
  });
}

const BENEFIT_ICONS: Record<string, typeof TruckIcon> = {
  shipping: TruckIcon,
  secure: ShieldIcon,
  pix: PixIcon,
  support: ChatIcon,
  authentic: SparkIcon,
  returns: ReturnIcon,
};

function Hero({ data }: { data: Route.ComponentProps["loaderData"] }) {
  const hero = data.hero;
  const title = hero?.title ?? data.storeName;
  return (
    <section className="mx-auto grid max-w-7xl items-center gap-10 px-4 pb-16 pt-10 md:grid-cols-12 md:px-8 md:pb-24 md:pt-16">
      <div className={hero?.image ? "md:col-span-6" : "md:col-span-8"}>
        <p className="eyebrow reveal">{data.storeName}</p>
        <h1 className="reveal reveal-delay-1 mt-5 text-5xl leading-[1.05] md:text-7xl">{title}</h1>
        <div className="reveal reveal-delay-2 mt-6 max-w-xl text-lg text-ink-soft">
          {hero && hero.subtitle.length > 0 ? <PrismicRichText field={hero.subtitle} /> : data.tagline && <p>{data.tagline}</p>}
        </div>
        <div className="reveal reveal-delay-2 mt-10 flex flex-wrap gap-4">
          {hero?.primary ? (
            <ButtonLink to={hero.primary.href}>{hero.primary.label}</ButtonLink>
          ) : (
            <ButtonLink to="/collections/all">Ver todos os produtos</ButtonLink>
          )}
          {hero?.secondary && (
            <ButtonLink to={hero.secondary.href} variant="secondary">
              {hero.secondary.label}
            </ButtonLink>
          )}
        </div>
      </div>
      {hero?.image && (
        <div className="reveal md:col-span-6 md:col-start-7">
          <ProductImage image={hero.image} name={title} sizes="(min-width: 768px) 50vw, 100vw" aspect="4 / 5" priority />
        </div>
      )}
    </section>
  );
}

function RecentlyViewed() {
  const ids = useRecentlyViewed();
  const fetcher = useFetcher<{ products: ProductSummary[] }>();
  const key = ids.slice(0, 8).join(",");
  useEffect(() => {
    if (key) fetcher.load(`/api/products?ids=${encodeURIComponent(key)}`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const products = fetcher.data?.products ?? [];
  if (!key || products.length === 0) return null;
  return (
    <section aria-labelledby="vistos" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
      <SectionHeading id="vistos" eyebrow="Para você" title="Vistos recentemente" />
      <ProductGrid products={products} />
    </section>
  );
}

export default function Home({ loaderData }: Route.ComponentProps) {
  const d = loaderData;
  return (
    <>
      <Hero data={d} />

      {d.categories.length > 0 && (
        <section aria-labelledby="categorias" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <SectionHeading id="categorias" eyebrow="Explore" title="Categorias" action={<Link to="/categories" className="text-sm underline underline-offset-4">Ver todas</Link>} />
          <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 md:gap-6">
            {d.categories.map((c) => (
              <li key={c.id}>
                <Link to={c.href} className="group block">
                  <ProductImage image={c.image} name={c.title} sizes="(min-width: 768px) 33vw, 50vw" aspect="1 / 1" />
                  <span className="font-display mt-3 block text-xl group-hover:underline">{c.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {d.featured.length > 0 && (
        <section aria-labelledby="destaques" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <SectionHeading id="destaques" eyebrow="Seleção" title="Destaques" />
          <ProductGrid products={d.featured} priorityCount={2} />
        </section>
      )}

      {d.banners.length > 0 && (
        <section aria-label="Promoções" className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:grid-cols-2 md:px-8">
          {d.banners.map((b, i) => {
            const body = (
              <div className="relative overflow-hidden bg-paper-deep">
                {b.image && <ProductImage image={b.image} name={b.title ?? "Promoção"} sizes="(min-width: 768px) 50vw, 100vw" aspect="16 / 9" />}
                {(b.title || b.text) && (
                  <div className={b.image ? "absolute inset-x-0 bottom-0 bg-gradient-to-t from-ink/80 to-transparent p-6 text-paper" : "p-8"}>
                    {b.title && <p className="font-display text-2xl">{b.title}</p>}
                    {b.text && <p className="mt-1 text-sm opacity-90">{b.text}</p>}
                    {b.href && b.linkLabel && <span className="mt-3 inline-block text-sm underline underline-offset-4">{b.linkLabel}</span>}
                  </div>
                )}
              </div>
            );
            return b.href ? (
              <Link key={i} to={b.href} className="block">
                {body}
              </Link>
            ) : (
              <div key={i}>{body}</div>
            );
          })}
        </section>
      )}

      {d.offers.length > 0 && (
        <section aria-labelledby="ofertas" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <SectionHeading id="ofertas" eyebrow="Por tempo limitado" title="Ofertas" action={<Link to="/offers" className="text-sm underline underline-offset-4">Ver ofertas</Link>} />
          <ProductGrid products={d.offers} />
        </section>
      )}

      {d.newArrivals.length > 0 && (
        <section aria-labelledby="novidades" className="mx-auto max-w-7xl px-4 py-16 md:px-8">
          <SectionHeading id="novidades" eyebrow="Acabou de chegar" title="Novidades" action={<Link to="/collections/all?ordem=newest" className="text-sm underline underline-offset-4">Ver tudo</Link>} />
          <ProductGrid products={d.newArrivals} priorityCount={d.featured.length ? 0 : 2} />
        </section>
      )}

      {d.benefits.length > 0 && (
        <section aria-label="Vantagens" className="border-y border-line bg-surface/60">
          <ul className="mx-auto grid max-w-7xl gap-8 px-4 py-12 sm:grid-cols-2 md:px-8 lg:grid-cols-4">
            {d.benefits.map((b) => {
              const Icon = BENEFIT_ICONS[b.icon] ?? SparkIcon;
              return (
                <li key={b.title} className="flex gap-4">
                  <Icon className="mt-1 shrink-0" />
                  <div>
                    <p className="font-medium">{b.title}</p>
                    {b.text && <p className="mt-1 text-sm text-muted">{b.text}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {d.testimonials.length > 0 && (
        <section aria-labelledby="depoimentos" className="mx-auto max-w-7xl px-4 py-20 md:px-8">
          <SectionHeading id="depoimentos" eyebrow="Quem já comprou" title="Depoimentos" />
          <ul className="grid gap-10 md:grid-cols-3">
            {d.testimonials.map((t) => (
              <li key={`${t.author}-${t.quote.slice(0, 20)}`}>
                <figure>
                  <blockquote className="font-display text-xl leading-relaxed">“{t.quote}”</blockquote>
                  <figcaption className="mt-4 text-sm text-muted">
                    {t.author}
                    {t.location && <> · {t.location}</>}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ul>
        </section>
      )}

      <RecentlyViewed />
    </>
  );
}
