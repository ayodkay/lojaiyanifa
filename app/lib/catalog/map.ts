// Prismic document → catalog domain model. Pure functions, no I/O.
//
// Documents published before a model change don't contain the newly added
// fields at all (the key is absent, not null), so every read tolerates
// `undefined` as "empty". That is Prismic's documented shape, not a guess.
import type { ImageField, LinkField, RichTextField } from "@prismicio/client";
import { asText, isFilled } from "@prismicio/client";

import { percentOff, toCents } from "~/lib/money";
import { fold, hasReplacementChar, splitList } from "~/lib/text";
import type {
  FaqDocument,
  HomepageDocument,
  PageDocument,
  ProductCategoryDocument,
  ProductsDocument,
  SettingsDocument,
} from "~/types/prismic.generated";

import { hrefFromLink } from "./links";
import type {
  Availability,
  CatalogCategory,
  CatalogImage,
  CatalogProduct,
  CatalogVariant,
  CatalogVideo,
  ContentIssue,
  ContentPage,
  Faq,
  Homepage,
  Seo,
  StoreSettings,
} from "./types";

const EMPTY_RICH_TEXT: RichTextField = [];

const AVAILABILITY: Record<string, Availability> = {
  "In stock": "in_stock",
  "Out of stock": "out_of_stock",
  "Pre-order": "preorder",
  Backorder: "backorder",
  Discontinued: "discontinued",
};

/** Availabilities that can be ordered (stock permitting for in_stock). */
export const SELLABLE: ReadonlySet<Availability> = new Set(["in_stock", "preorder", "backorder"]);

/** Empty select → the model's declared default ("In stock"). */
export function mapAvailability(value: string | null | undefined): Availability {
  return (value && AVAILABILITY[value]) || "in_stock";
}

export function mapImage(field: ImageField | null | undefined, fallbackAlt: string): CatalogImage | null {
  if (!field || !isFilled.image(field)) return null;
  return {
    url: field.url,
    alt: field.alt?.trim() || fallbackAlt,
    width: field.dimensions.width,
    height: field.dimensions.height,
  };
}

function rich(field: RichTextField | null | undefined): RichTextField {
  return field && isFilled.richText(field) ? field : EMPTY_RICH_TEXT;
}

function textOrNull(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function numberOrNull(value: number | null | undefined): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function positiveOrNull(value: number | null | undefined): number | null {
  const n = numberOrNull(value);
  return n !== null && n > 0 ? n : null;
}

/** Whole number ≥ 0 (0 is meaningful: sold out); anything else is "not given". */
function stockOrNull(value: number | null | undefined): number | null {
  const n = numberOrNull(value);
  return n !== null && Number.isInteger(n) && n >= 0 ? n : null;
}

/** Document ID of a filled, non-broken content-relationship (or any document link). */
function relationId(field: unknown): string | null {
  if (!field || typeof field !== "object") return null;
  const link = field as { link_type?: string; id?: string; isBroken?: boolean };
  if (link.link_type !== "Document" || !link.id || link.isBroken) return null;
  return link.id;
}

function relationIds(rows: readonly { [key: string]: unknown }[] | undefined, key: string): string[] {
  const ids: string[] = [];
  for (const row of rows ?? []) {
    const id = relationId(row[key]);
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function mapSeo(data: { meta_title?: string | null; meta_description?: string | null; meta_image?: ImageField }, fallbackAlt: string): Seo {
  return {
    title: textOrNull(data.meta_title),
    description: textOrNull(data.meta_description),
    image: mapImage(data.meta_image, fallbackAlt),
  };
}

const YOUTUBE_ID = /(?:youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/;
const VIMEO_ID = /vimeo\.com\/(?:video\/)?(\d+)/;

/** Builds our own privacy-friendly iframe URL instead of rendering provider HTML. */
export function videoFromEmbedUrl(url: string, title: string): Omit<CatalogVideo, "poster"> | null {
  const yt = YOUTUBE_ID.exec(url);
  if (yt) return { provider: "youtube", src: `https://www.youtube-nocookie.com/embed/${yt[1]}`, title };
  const vimeo = VIMEO_ID.exec(url);
  if (vimeo) return { provider: "vimeo", src: `https://player.vimeo.com/video/${vimeo[1]}?dnt=1`, title };
  return null;
}

export function mapProduct(doc: ProductsDocument): CatalogProduct {
  const d = doc.data;
  const name = textOrNull(d.product_name) ?? doc.uid;
  const issues: ContentIssue[] = [];

  const priceCents = toCents(positiveOrNull(d.price));
  const originalPriceCents = toCents(positiveOrNull(d.original_price));
  const statedDiscount = numberOrNull(d.discount_percentage);
  const computedDiscount =
    priceCents !== null && originalPriceCents !== null ? percentOff(priceCents, originalPriceCents) : null;

  if (originalPriceCents !== null && priceCents !== null && originalPriceCents <= priceCents) {
    issues.push({
      code: "original_price_not_higher",
      message: "O preço original deve ser maior que o preço de venda para exibir desconto.",
    });
  }
  if (statedDiscount !== null && statedDiscount > 0) {
    if (originalPriceCents === null) {
      issues.push({
        code: "discount_without_original_price",
        message: `Desconto de ${statedDiscount}% informado sem preço original; o desconto não é exibido.`,
      });
    } else if (computedDiscount !== null && Math.abs(computedDiscount - statedDiscount) > 1) {
      issues.push({
        code: "discount_mismatch",
        message: `Desconto informado (${statedDiscount}%) difere do calculado pelos preços (${computedDiscount}%); exibimos ${computedDiscount}%.`,
      });
    }
  }

  const availability = mapAvailability(d.availability);

  const images: CatalogImage[] = [];
  const main = mapImage(d.main_image, name);
  if (main) images.push(main);
  for (const row of d.gallery ?? []) {
    const img = mapImage(row.image, name);
    if (img && !images.some((i) => i.url === img.url)) images.push(img);
  }
  if (images.length === 0) issues.push({ code: "missing_image", message: "Produto sem imagem." });

  const videos: CatalogVideo[] = [];
  for (const row of d.videos ?? []) {
    const poster = mapImage(row.video_poster, name);
    const embed = row.video_embed && "embed_url" in row.video_embed ? row.video_embed : null;
    if (embed?.embed_url) {
      const video = videoFromEmbedUrl(embed.embed_url, (typeof embed.title === "string" && embed.title) || name);
      if (video) videos.push({ ...video, poster });
    } else if (row.video_file && isFilled.linkToMedia(row.video_file) && row.video_file.url) {
      videos.push({ provider: "file", src: row.video_file.url, title: name, poster });
    }
  }

  const variants: CatalogVariant[] = [];
  for (const row of d.variants ?? []) {
    const meaningful = [row.variant_name, row.variant_sku, row.size, row.color, row.material, row.other_option].some(
      (v) => textOrNull(v) !== null,
    ) || numberOrNull(row.variant_price) !== null;
    if (!meaningful) continue; // a row holding only defaults is an empty row
    const sku = textOrNull(row.variant_sku);
    const options = {
      size: textOrNull(row.size),
      color: textOrNull(row.color),
      material: textOrNull(row.material),
      other: textOrNull(row.other_option),
    };
    const label =
      textOrNull(row.variant_name) ??
      [options.size, options.color, options.material, options.other].filter(Boolean).join(" / ");
    if (!sku) {
      issues.push({ code: "variant_missing_sku", message: `Variante "${label || "sem nome"}" sem SKU; ela não aparece na loja.` });
      continue;
    }
    const variantPrice = toCents(positiveOrNull(row.variant_price)) ?? priceCents;
    const variantAvailability = row.variant_availability ? mapAvailability(row.variant_availability) : availability;
    const variantStock = stockOrNull(row.variant_stock);
    if (numberOrNull(row.variant_stock) !== null && variantStock === null) {
      issues.push({
        code: "invalid_stock",
        message: `Estoque da variante "${label || sku}" deve ser um número inteiro ≥ 0; o estoque dela não é controlado.`,
      });
    }
    variants.push({
      sku,
      name: label || sku,
      options,
      colorSwatch: textOrNull(row.color_swatch),
      priceCents: variantPrice,
      availability: variantAvailability,
      image: mapImage(row.variant_image, `${name} — ${label || sku}`),
      weightGrams: positiveOrNull(row.variant_weight_grams),
      prismicStock: variantStock,
      purchasable: variantPrice !== null && SELLABLE.has(variantAvailability),
    });
  }

  const sku = textOrNull(d.sku);
  if (!sku && variants.length === 0) issues.push({ code: "missing_sku", message: "Produto sem SKU." });

  const prismicStock = stockOrNull(d.stock_quantity);
  if (numberOrNull(d.stock_quantity) !== null && prismicStock === null) {
    issues.push({
      code: "invalid_stock",
      message: "Estoque deve ser um número inteiro ≥ 0; o estoque deste produto não é controlado.",
    });
  }

  const hasAnyPrice = priceCents !== null || variants.some((v) => v.priceCents !== null);
  if (!hasAnyPrice) issues.push({ code: "missing_price", message: "Produto sem preço; não pode ser vendido." });

  const shipping = {
    weightGrams: positiveOrNull(d.weight_grams),
    lengthCm: positiveOrNull(d.length_cm),
    widthCm: positiveOrNull(d.width_cm),
    heightCm: positiveOrNull(d.height_cm),
    pickupOnly: d.pickup_only === true,
  };
  if (!shipping.pickupOnly && [shipping.weightGrams, shipping.lengthCm, shipping.widthCm, shipping.heightCm].includes(null)) {
    issues.push({
      code: "missing_shipping_dimensions",
      message: "Peso ou dimensões da embalagem ausentes; o frete não pode ser calculado.",
    });
  }

  if (hasReplacementChar(name) || hasReplacementChar(asText(rich(d.short_description)))) {
    issues.push({ code: "broken_encoding", message: "Texto com caractere inválido (�); corrija a acentuação no Prismic." });
  }

  const purchasable =
    variants.length > 0
      ? variants.some((v) => v.purchasable)
      : sku !== null && priceCents !== null && SELLABLE.has(availability);

  return {
    id: doc.id,
    uid: doc.uid,
    name,
    sku,
    shortDescription: rich(d.short_description),
    description: rich(d.description),
    keywords: splitList(d.search_keywords),
    priceCents,
    originalPriceCents: computedDiscount !== null ? originalPriceCents : null,
    discountPercent: computedDiscount,
    availability,
    showStock: d.show_stock_quantity === true,
    prismicStock,
    images,
    videos,
    variants,
    variantImages: (d.variant_images ?? []).flatMap((row) => {
      const key = textOrNull(row.variant_key);
      const image = mapImage(row.image, name);
      return key && image ? [{ key, image }] : [];
    }),
    sizeGuide: rich(d.size_guide),
    sizeGuideImage: mapImage(d.size_guide_image, `Guia de tamanhos — ${name}`),
    specifications: (d.specifications ?? []).flatMap((row) => {
      const label = textOrNull(row.spec_label);
      const value = textOrNull(row.spec_value);
      return label && value ? [{ label, value }] : [];
    }),
    materials: rich(d.materials),
    warrantyInfo: rich(d.warranty_info),
    returnInfo: rich(d.return_info),
    shipping,
    relatedIds: relationIds(d.related_products, "product").filter((id) => id !== doc.id),
    boughtTogetherIds: relationIds(d.bought_together, "product").filter((id) => id !== doc.id),
    seo: mapSeo(d, name),
    tags: doc.tags,
    firstPublishedAt: doc.first_publication_date,
    lastPublishedAt: doc.last_publication_date,
    purchasable,
    issues,
  };
}

export function mapCategory(doc: ProductCategoryDocument): CatalogCategory {
  const d = doc.data;
  const title = textOrNull(d.title) ?? doc.uid;
  return {
    id: doc.id,
    uid: doc.uid,
    title,
    intro: rich(d.intro),
    kind: d.kind === "Collection" ? "collection" : "category",
    image: mapImage(d.image, title),
    parentId: relationId(d.parent_category),
    productIds: relationIds(d.products, "product"),
    showAll: d.show_all_products === true,
    seo: mapSeo(d, title),
  };
}

const DAY_INDEX: Record<string, number> = {
  Sunday: 0,
  Monday: 1,
  Tuesday: 2,
  Wednesday: 3,
  Thursday: 4,
  Friday: 5,
  Saturday: 6,
};
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function emptySettings(): StoreSettings {
  return mapSettings(null);
}

export function mapSettings(doc: SettingsDocument | null): StoreSettings {
  const d = (doc?.data ?? {}) as Partial<SettingsDocument["data"]>;
  const storeName = textOrNull(d.store_name) ?? "Loja Iyanifa";
  const whatsappDigits = (d.whatsapp_number ?? "").replace(/\D/g, "");
  return {
    storeName,
    tagline: textOrNull(d.tagline),
    logo: mapImage(d.logo, storeName),
    announcement: textOrNull(d.announcement),
    announcementHref: hrefFromLink(d.announcement_link),
    company: {
      legalName: textOrNull(d.legal_name),
      taxId: textOrNull(d.tax_id),
      addressLine: textOrNull(d.address_line),
      city: textOrNull(d.city),
      state: textOrNull(d.state),
      postalCode: textOrNull(d.postal_code),
    },
    contact: {
      email: textOrNull(d.support_email),
      phone: textOrNull(d.phone),
      // Brazilian mobile in international format: 55 + DDD (2) + 8–9 digits.
      whatsappNumber: /^55\d{10,11}$/.test(whatsappDigits) ? whatsappDigits : null,
      whatsappMessage: textOrNull(d.whatsapp_message),
      hours: (d.business_hours ?? []).flatMap((row) => {
        const day = row.day ? DAY_INDEX[row.day] : undefined;
        const opens = row.opens?.trim() ?? "";
        const closes = row.closes?.trim() ?? "";
        return day !== undefined && HHMM.test(opens) && HHMM.test(closes) ? [{ day, opens, closes }] : [];
      }),
    },
    menuCategoryIds: relationIds(d.menu_categories, "category"),
    footerLinks: (d.footer_links ?? []).flatMap((row) => {
      const label = textOrNull(row.label);
      const href = hrefFromLink(row.link);
      return label && href ? [{ label, href }] : [];
    }),
    socialLinks: (d.social_links ?? []).flatMap((row) => {
      const href = hrefFromLink(row.url);
      return row.network && href ? [{ network: row.network, href }] : [];
    }),
    synonymGroups: (d.synonym_groups ?? [])
      .map((row) => splitList(row.terms).map(fold))
      .filter((group) => group.length > 1),
    popularSearches: (d.popular_searches ?? []).flatMap((row) => (textOrNull(row.term) ? [row.term!.trim()] : [])),
    policies: {
      returns: rich(d.return_policy_summary),
      warranty: rich(d.warranty_summary),
      shipping: rich(d.shipping_summary),
    },
    seo: {
      title: textOrNull(d.default_meta_title),
      description: textOrNull(d.default_meta_description),
      image: mapImage(d.default_meta_image, storeName),
    },
    verification: {
      google: textOrNull(d.google_site_verification),
      bing: textOrNull(d.bing_site_verification),
    },
  };
}

function cta(label: string | null | undefined, link: LinkField | null | undefined) {
  const text = textOrNull(label);
  const href = hrefFromLink(link);
  return text && href ? { label: text, href } : null;
}

export function mapHomepage(doc: HomepageDocument): Homepage {
  const d = doc.data;
  return {
    hero: {
      title: textOrNull(d.hero_title),
      subtitle: rich(d.hero_subtitle),
      image: mapImage(d.hero_image, textOrNull(d.hero_title) ?? "Loja Iyanifa"),
      primary: cta(d.hero_cta_label, d.hero_cta_link),
      secondary: cta(d.hero_secondary_cta_label, d.hero_secondary_cta_link),
    },
    featuredProductIds: relationIds(d.featured_products, "product"),
    featuredCategoryIds: relationIds(d.featured_categories, "category"),
    banners: (d.promo_banners ?? [])
      .map((row) => ({
        image: mapImage(row.image, textOrNull(row.title) ?? "Promoção"),
        title: textOrNull(row.title),
        text: textOrNull(row.text),
        linkLabel: textOrNull(row.link_label),
        href: hrefFromLink(row.link),
        startsAt: row.starts_at ?? null,
        endsAt: row.ends_at ?? null,
      }))
      .filter((b) => b.image || b.title),
    benefits: (d.benefits ?? []).flatMap((row) => {
      const title = textOrNull(row.title);
      return title ? [{ icon: row.icon ?? "shipping", title, text: textOrNull(row.text) }] : [];
    }),
    testimonials: (d.testimonials ?? []).flatMap((row) => {
      const quote = textOrNull(row.quote);
      const author = textOrNull(row.author);
      return quote && author ? [{ quote, author, location: textOrNull(row.location) }] : [];
    }),
    newsletter: { title: textOrNull(d.newsletter_title), text: textOrNull(d.newsletter_text) },
    seo: mapSeo(d, "Loja Iyanifa"),
  };
}

export function mapPage(doc: PageDocument): ContentPage {
  const title = textOrNull(doc.data.title) ?? doc.uid;
  return {
    id: doc.id,
    uid: doc.uid,
    title,
    body: rich(doc.data.body),
    lastUpdated: doc.data.last_updated ?? null,
    seo: mapSeo(doc.data, title),
  };
}

export function mapFaq(doc: FaqDocument): Faq {
  const d = doc.data;
  return {
    title: textOrNull(d.title) ?? "Perguntas frequentes",
    intro: rich(d.intro),
    items: (d.items ?? []).flatMap((row) => {
      const question = textOrNull(row.question);
      return question && isFilled.richText(row.answer)
        ? [{ topic: row.topic ?? "Orders", question, answer: row.answer }]
        : [];
    }),
    seo: mapSeo(d, "Perguntas frequentes"),
  };
}

/** Flags SKUs used by more than one product or variant (stock would be shared by mistake). */
export function flagDuplicateSkus(products: CatalogProduct[]): void {
  const owners = new Map<string, string[]>();
  for (const p of products) {
    const skus = p.variants.length > 0 ? p.variants.map((v) => v.sku) : p.sku ? [p.sku] : [];
    for (const sku of skus) owners.set(sku, [...(owners.get(sku) ?? []), p.uid]);
  }
  for (const [sku, uids] of owners) {
    const distinct = [...new Set(uids)];
    if (uids.length < 2) continue;
    for (const p of products) {
      if (!distinct.includes(p.uid)) continue;
      p.issues.push({ code: "duplicate_sku", message: `SKU ${sku} também usado em: ${uids.filter((u) => u !== p.uid).join(", ") || p.uid}.` });
    }
  }
}
