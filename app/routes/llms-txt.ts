// /llms.txt — the store described for AI assistants (https://llmstxt.org), built from the same Prismic content as the
// pages (app/lib/store-profile.ts). A route rather than a file in public/: the WhatsApp link carries the owner's phone
// number, which stays out of the repository, and the product list follows the catalog. Unlike /robots.txt, this path
// reaches the deployed function: on 2026-11-06 production answered /llms.txt with the store's own 404 page.
import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { llmsTxt } from "~/lib/store-profile";

export async function loader() {
  const { catalog, settings, homepage, pages } = await getContent();
  return new Response(llmsTxt({ siteUrl: env().SITE_URL, catalog, settings, homepage, pages }), {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "public, max-age=0, s-maxage=3600",
    },
  });
}
