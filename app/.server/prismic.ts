// Prismic access for the server. The whole catalog (products, categories,
// settings, homepage, pages, FAQ) is small enough to hold in memory, so it is
// loaded once per Prismic *release* (master ref) and queried locally.
//
// Freshness: the master ref is re-checked at most every REF_TTL_MS. When an
// editor publishes, the ref changes and the next request reloads the catalog.
import * as prismic from "@prismicio/client";

import { flagDuplicateSkus, mapCategory, mapFaq, mapHomepage, mapPage, mapProduct, mapSettings } from "~/lib/catalog/map";
import { buildCatalog, type Catalog } from "~/lib/catalog/query";
import type { ContentPage, Faq, Homepage, StoreSettings } from "~/lib/catalog/types";
import type { AllDocumentTypes } from "~/types/prismic.generated";

import { env } from "./env";

const REF_TTL_MS = 10_000;

export interface Content {
  ref: string;
  loadedAt: string;
  catalog: Catalog;
  settings: StoreSettings;
  homepage: Homepage | null;
  pages: Map<string, ContentPage>;
  faq: Faq | null;
}

let client: prismic.Client<AllDocumentTypes> | null = null;
function getClient(): prismic.Client<AllDocumentTypes> {
  if (!client) {
    const { PRISMIC_REPO, PRISMIC_ACCESS_TOKEN } = env();
    client = prismic.createClient<AllDocumentTypes>(PRISMIC_REPO, { accessToken: PRISMIC_ACCESS_TOKEN });
  }
  return client;
}

let ref: { value: string; checkedAt: number } | null = null;
let content: Content | null = null;
let inflight: Promise<Content> | null = null;

async function masterRef(): Promise<string> {
  if (ref && Date.now() - ref.checkedAt < REF_TTL_MS) return ref.value;
  const master = await getClient().getMasterRef();
  ref = { value: master.ref, checkedAt: Date.now() };
  return master.ref;
}

async function single<T extends prismic.PrismicDocument>(load: () => Promise<T>): Promise<T | null> {
  try {
    return await load();
  } catch (error) {
    // Only "no such document yet" is an expected empty state; anything else is a real failure.
    if (error instanceof prismic.NotFoundError) return null;
    throw error;
  }
}

async function load(atRef: string): Promise<Content> {
  const c = getClient();
  const lang = env().PRISMIC_LOCALE;
  const params = { ref: atRef, lang };
  const [productDocs, categoryDocs, pageDocs, settingsDoc, homepageDoc, faqDoc] = await Promise.all([
    c.getAllByType("products", params),
    c.getAllByType("product_category", params),
    c.getAllByType("page", params),
    single(() => c.getSingle("settings", params)),
    single(() => c.getSingle("homepage", params)),
    single(() => c.getSingle("faq", params)),
  ]);

  const products = productDocs.map(mapProduct);
  flagDuplicateSkus(products);
  return {
    ref: atRef,
    loadedAt: new Date().toISOString(),
    catalog: buildCatalog(products, categoryDocs.map(mapCategory)),
    settings: mapSettings(settingsDoc),
    homepage: homepageDoc ? mapHomepage(homepageDoc) : null,
    pages: new Map(pageDocs.map((doc) => [doc.uid, mapPage(doc)])),
    faq: faqDoc ? mapFaq(faqDoc) : null,
  };
}

/** Current published content. Serves the last good copy (logged as an error) if Prismic is briefly unreachable. */
export async function getContent(): Promise<Content> {
  let currentRef: string;
  try {
    currentRef = await masterRef();
  } catch (error) {
    if (content) {
      console.error("[prismic] master ref check failed; serving content from ref", content.ref, error);
      return content;
    }
    throw error;
  }
  if (content?.ref === currentRef) return content;
  inflight ??= load(currentRef)
    .then((fresh) => {
      content = fresh;
      return fresh;
    })
    .catch((error) => {
      if (content) {
        console.error("[prismic] reload failed; serving content from ref", content.ref, error);
        return content;
      }
      throw error;
    })
    .finally(() => {
      inflight = null;
    });
  return inflight;
}
