// /sitemap.xml — every indexable URL, with lastmod from Prismic publication dates.
import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { categoryProducts } from "~/lib/catalog/query";
import { pagePath } from "~/lib/catalog/links";
import { categoryHref } from "~/lib/shell";

const escapeXml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export async function loader() {
  const site = env().SITE_URL;
  const { catalog, pages, faq } = await getContent();
  const latest = (dates: string[]) => dates.sort().at(-1);
  const entries: { loc: string; lastmod?: string }[] = [
    { loc: "/", lastmod: latest(catalog.products.map((p) => p.lastPublishedAt)) },
    { loc: "/collections/all", lastmod: latest(catalog.products.map((p) => p.lastPublishedAt)) },
    { loc: "/categories" },
    { loc: "/collections" },
    { loc: "/offers" },
    ...catalog.categories.map((c) => ({
      loc: categoryHref(c),
      lastmod: latest(categoryProducts(catalog, c.id).map((p) => p.lastPublishedAt)),
    })),
    ...catalog.products.map((p) => ({ loc: `/products/${p.uid}`, lastmod: p.lastPublishedAt })),
    ...[...pages.values()].map((p) => ({ loc: pagePath(p.uid) })),
    ...(faq && faq.items.length > 0 ? [{ loc: "/faq" }] : []),
    { loc: "/contact" },
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries
  .map(
    (e) =>
      `  <url><loc>${escapeXml(`${site}${e.loc}`)}</loc>${e.lastmod ? `<lastmod>${new Date(e.lastmod).toISOString()}</lastmod>` : ""}</url>`,
  )
  .join("\n")}
</urlset>
`;
  return new Response(body, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
