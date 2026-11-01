// /robots.txt — private and transactional areas are not crawled; search
// results stay crawlable but carry `noindex`.
import { env } from "~/.server/env";

export function loader() {
  const site = env().SITE_URL;
  const isProduction = site.startsWith("https://") && !/staging|preview|localhost/.test(site);
  const rules = isProduction
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /account",
        "Disallow: /orders",
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /order-confirmation",
        "Disallow: /wishlist",
        "Disallow: /api/",
        "",
        `Sitemap: ${site}/sitemap.xml`,
      ]
    : // Never let a staging or local environment get indexed.
      ["User-agent: *", "Disallow: /"];
  return new Response(`${rules.join("\n")}\n`, {
    headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=0, s-maxage=3600" },
  });
}
