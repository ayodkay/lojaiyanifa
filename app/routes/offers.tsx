// /offers — products with a real discount (original price above the selling price).
import { data, Link } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { ListingPage } from "~/components/listing";
import { buildListing, listingCanonical } from "~/lib/catalog/listing";
import { PUBLIC_CACHE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";

import type { Route } from "./+types/offers";

export async function loader({ request }: Route.LoaderArgs) {
  const { catalog, settings } = await getContent();
  const discounted = catalog.products.filter((p) => p.discountPercent !== null && p.purchasable);
  return data(
    { siteUrl: env().SITE_URL, storeName: settings.storeName, listing: buildListing(catalog, discounted, new URL(request.url)) },
    { headers: PUBLIC_CACHE },
  );
}

export function headers({ loaderHeaders }: Route.HeadersArgs) {
  return loaderHeaders;
}

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [];
  return seoMeta({
    siteUrl: loaderData.siteUrl,
    storeName: loaderData.storeName,
    path: listingCanonical("/offers", loaderData.listing.page),
    title: "Ofertas",
    description: `Produtos com desconto na ${loaderData.storeName}.`,
  });
}

export default function Offers({ loaderData }: Route.ComponentProps) {
  return (
    <ListingPage
      title="Ofertas"
      eyebrow="Descontos e promoções"
      breadcrumbs={[
        { name: "Início", href: "/" },
        { name: "Ofertas", href: "/offers" },
      ]}
      listing={loaderData.listing}
      empty={
        <p className="text-muted">
          Não há ofertas no momento.{" "}
          <Link to="/collections/all" className="text-ink underline underline-offset-4">
            Ver todos os produtos
          </Link>
        </p>
      }
    />
  );
}
