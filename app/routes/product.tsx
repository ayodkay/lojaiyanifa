// /products/:uid
import { asText } from "@prismicio/client";
import { useEffect, useRef } from "react";
import { data } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { CloseIcon } from "~/components/icons";
import { Gallery, PurchasePanel, ShareButton, useVariantSelection, Videos } from "~/components/product";
import { ProductGrid } from "~/components/product-card";
import { RichText } from "~/components/rich-text";
import { Breadcrumbs, ProductImage, SectionHeading } from "~/components/ui";
import { SELLABLE } from "~/lib/catalog/map";
import { ancestors, primaryCategory, priceRange, relatedProducts, toSummary } from "~/lib/catalog/query";
import type { Availability, CatalogProduct } from "~/lib/catalog/types";
import { recentlyViewed } from "~/lib/client-store";
import { PUBLIC_CACHE } from "~/lib/http";
import { imgixSrc } from "~/lib/images";
import { toDecimalString } from "~/lib/money";
import { breadcrumbJsonLd, seoMeta } from "~/lib/seo";
import { categoryHref } from "~/lib/shell";

import type { Route } from "./+types/product";

export async function loader({ params }: Route.LoaderArgs) {
  const { catalog, settings } = await getContent();
  const found = catalog.productsByUid.get(params.uid);
  if (!found) throw data("Produto não encontrado", { status: 404 });
  // Content-health issues are for the admin only.
  const { issues: _internal, ...product } = found;

  const category = primaryCategory(catalog, found.id, settings.menuCategoryIds);
  const chain = category ? [...ancestors(catalog, category.id), category] : [];
  const boughtTogether = found.boughtTogetherIds
    .map((id) => catalog.productsById.get(id))
    .filter((p): p is CatalogProduct => Boolean(p?.purchasable))
    .map(toSummary);

  return data(
    {
      siteUrl: env().SITE_URL,
      storeName: settings.storeName,
      product,
      breadcrumbs: [
        { name: "Início", href: "/" },
        ...chain.map((c) => ({ name: c.title, href: categoryHref(c) })),
        { name: found.name, href: `/products/${found.uid}` },
      ],
      related: relatedProducts(catalog, found).map(toSummary),
      boughtTogether,
      policies: settings.policies,
    },
    { headers: PUBLIC_CACHE },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

const SCHEMA_AVAILABILITY: Record<Availability, string> = {
  in_stock: "https://schema.org/InStock",
  out_of_stock: "https://schema.org/OutOfStock",
  preorder: "https://schema.org/PreOrder",
  backorder: "https://schema.org/BackOrder",
  discontinued: "https://schema.org/Discontinued",
};

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Produto não encontrado" }, { name: "robots", content: "noindex" }];
  const { product: p, siteUrl, storeName, breadcrumbs } = loaderData;
  const url = `${siteUrl}/products/${p.uid}`;
  const description = p.seo.description ?? (asText(p.shortDescription) || asText(p.description) || null);
  const range = priceRange(p as CatalogProduct);
  const offers =
    range === null
      ? undefined
      : p.variants.length > 1
        ? {
            "@type": "AggregateOffer",
            priceCurrency: "BRL",
            lowPrice: toDecimalString(range.min),
            highPrice: toDecimalString(range.max),
            offerCount: p.variants.length,
            availability: SCHEMA_AVAILABILITY[p.variants.some((v) => SELLABLE.has(v.availability)) ? "in_stock" : "out_of_stock"],
            url,
          }
        : {
            "@type": "Offer",
            priceCurrency: "BRL",
            price: toDecimalString(range.min),
            availability: SCHEMA_AVAILABILITY[p.variants[0]?.availability ?? p.availability],
            itemCondition: "https://schema.org/NewCondition",
            url,
            seller: { "@type": "Organization", name: storeName },
          };
  return seoMeta({
    siteUrl,
    storeName,
    path: `/products/${p.uid}`,
    title: p.seo.title ?? p.name,
    description,
    image: p.seo.image ?? p.images[0] ?? null,
    type: "product",
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "Product",
        name: p.name,
        url,
        ...(p.sku ? { sku: p.sku } : {}),
        ...(description ? { description } : {}),
        ...(p.images.length ? { image: p.images.map((i) => imgixSrc(i.url, { w: 1200, fit: "max" })) } : {}),
        ...(offers ? { offers } : {}),
      },
      breadcrumbJsonLd(siteUrl, breadcrumbs.map((b) => ({ name: b.name, path: b.href }))),
    ],
  });
}

function Details({ summary, children }: { summary: string; children: React.ReactNode }) {
  return (
    <details className="group border-t border-line py-4">
      <summary className="flex cursor-pointer list-none items-center justify-between font-display text-lg">
        {summary}
        <span aria-hidden="true" className="text-muted transition-transform group-open:rotate-45">
          +
        </span>
      </summary>
      <div className="pt-4 text-sm">{children}</div>
    </details>
  );
}

export default function Product({ loaderData }: Route.ComponentProps) {
  const { product, breadcrumbs, related, boughtTogether, policies, siteUrl } = loaderData;
  const p = product as CatalogProduct;
  const state = useVariantSelection(p);
  const sizeGuide = useRef<HTMLDialogElement>(null);
  useEffect(() => recentlyViewed.push(p.id), [p.id]);

  const variantImage = state.selected?.image ?? p.variantImages.find((vi) => vi.key === state.selected?.sku || vi.key === state.selected?.name)?.image ?? null;
  const hasSizeGuide = p.sizeGuide.length > 0 || p.sizeGuideImage;
  const s = p.shipping;
  const specs = [
    ...p.specifications,
    ...(state.selected?.sku ?? p.sku ? [{ label: "SKU", value: (state.selected?.sku ?? p.sku)! }] : []),
    ...(s.weightGrams ? [{ label: "Peso (embalado)", value: `${s.weightGrams} g` }] : []),
    ...(s.lengthCm && s.widthCm && s.heightCm ? [{ label: "Dimensões (embalagem)", value: `${s.lengthCm} × ${s.widthCm} × ${s.heightCm} cm` }] : []),
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 md:px-8">
      <Breadcrumbs items={breadcrumbs} />
      <div className="mt-8 grid gap-10 lg:grid-cols-2 lg:gap-16">
        <div className="lg:sticky lg:top-28 lg:self-start">
          <Gallery images={p.images} name={p.name} activeImage={variantImage} />
        </div>
        <div>
          <h1 className="text-4xl md:text-5xl">{p.name}</h1>
          <RichText field={p.shortDescription} className="mt-4 text-lg text-ink-soft" />
          <div className="mt-8">
            <PurchasePanel product={p} state={state} />
          </div>
          {hasSizeGuide && (
            <button type="button" className="mt-2 text-sm underline underline-offset-4" onClick={() => sizeGuide.current?.showModal()}>
              Guia de tamanhos
            </button>
          )}
          <div className="mt-6">
            <ShareButton url={`${siteUrl}/products/${p.uid}`} title={p.name} />
          </div>

          <div className="mt-10">
            {p.description.length > 0 && (
              <Details summary="Descrição">
                <RichText field={p.description} />
              </Details>
            )}
            {specs.length > 0 && (
              <Details summary="Especificações">
                <dl className="grid grid-cols-[auto_1fr] gap-x-6 gap-y-2">
                  {specs.map((spec) => (
                    <div key={spec.label} className="contents">
                      <dt className="text-muted">{spec.label}</dt>
                      <dd>{spec.value}</dd>
                    </div>
                  ))}
                </dl>
              </Details>
            )}
            {p.materials.length > 0 && (
              <Details summary="Materiais e ingredientes">
                <RichText field={p.materials} />
              </Details>
            )}
            {(policies.shipping.length > 0 || s.pickupOnly) && (
              <Details summary="Entrega">
                {s.pickupOnly && <p className="mb-3 font-medium">Disponível somente para retirada no local.</p>}
                <RichText field={policies.shipping} />
              </Details>
            )}
            {(p.returnInfo.length > 0 || policies.returns.length > 0) && (
              <Details summary="Trocas e devoluções">
                <RichText field={p.returnInfo.length > 0 ? p.returnInfo : policies.returns} />
              </Details>
            )}
            {(p.warrantyInfo.length > 0 || policies.warranty.length > 0) && (
              <Details summary="Garantia">
                <RichText field={p.warrantyInfo.length > 0 ? p.warrantyInfo : policies.warranty} />
              </Details>
            )}
          </div>
        </div>
      </div>

      <Videos videos={p.videos} />

      {boughtTogether.length > 0 && (
        <section aria-labelledby="juntos" className="mt-24">
          <SectionHeading id="juntos" eyebrow="Combina com" title="Frequentemente comprados juntos" />
          <ProductGrid products={boughtTogether} />
        </section>
      )}
      {related.length > 0 && (
        <section aria-labelledby="relacionados" className="mt-24">
          <SectionHeading id="relacionados" eyebrow="Você também pode gostar" title="Produtos relacionados" />
          <ProductGrid products={related} />
        </section>
      )}

      {hasSizeGuide && (
        <dialog ref={sizeGuide} aria-labelledby="guia-titulo" className="m-auto w-[min(48rem,95vw)] bg-paper p-0">
          <div className="flex items-center justify-between border-b border-line px-6 py-4">
            <h2 id="guia-titulo" className="text-2xl">
              Guia de tamanhos
            </h2>
            <button type="button" className="p-2" aria-label="Fechar" onClick={() => sizeGuide.current?.close()}>
              <CloseIcon />
            </button>
          </div>
          <div className="space-y-6 px-6 py-6">
            <RichText field={p.sizeGuide} />
            {p.sizeGuideImage && <ProductImage image={p.sizeGuideImage} name="Guia de tamanhos" sizes="48rem" aspect={`${p.sizeGuideImage.width} / ${p.sizeGuideImage.height}`} />}
          </div>
        </dialog>
      )}
    </div>
  );
}
