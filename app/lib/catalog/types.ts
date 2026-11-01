// Domain model for the catalog. Prismic documents are mapped into these plain,
// serializable shapes (app/lib/catalog/map.ts) so the rest of the app never
// depends on Prismic's field structure directly.
import type { RichTextField } from "@prismicio/client";

import type { Cents } from "~/lib/money";

export type Availability = "in_stock" | "out_of_stock" | "preorder" | "backorder" | "discontinued";

export interface CatalogImage {
  url: string;
  alt: string;
  width: number;
  height: number;
}

export interface CatalogVideo {
  provider: "youtube" | "vimeo" | "file";
  /** Privacy-friendly embed URL (youtube-nocookie / player.vimeo) or the MP4 URL. */
  src: string;
  title: string;
  poster: CatalogImage | null;
}

export interface VariantOptions {
  size: string | null;
  color: string | null;
  material: string | null;
  other: string | null;
}

export interface CatalogVariant {
  sku: string;
  name: string;
  options: VariantOptions;
  colorSwatch: string | null;
  /** Resolved price: the variant's own price, or the product price when empty. */
  priceCents: Cents | null;
  /** Resolved availability: the variant's own, or the product's when empty. */
  availability: Availability;
  image: CatalogImage | null;
  weightGrams: number | null;
  /** Stock typed in Prismic (whole number ≥ 0) or null. Only a starting value — see CatalogProduct.prismicStock. */
  prismicStock: number | null;
  purchasable: boolean;
}

export interface ShippingSpec {
  weightGrams: number | null;
  lengthCm: number | null;
  widthCm: number | null;
  heightCm: number | null;
  pickupOnly: boolean;
}

export interface Seo {
  title: string | null;
  description: string | null;
  image: CatalogImage | null;
}

export type ContentIssueCode =
  | "missing_price"
  | "missing_sku"
  | "missing_image"
  | "missing_shipping_dimensions"
  | "discount_without_original_price"
  | "discount_mismatch"
  | "original_price_not_higher"
  | "variant_missing_sku"
  | "duplicate_sku"
  | "invalid_stock"
  | "broken_encoding";

export interface ContentIssue {
  code: ContentIssueCode;
  message: string;
}

export interface CatalogProduct {
  id: string;
  uid: string;
  name: string;
  sku: string | null;
  shortDescription: RichTextField;
  description: RichTextField;
  keywords: string[];
  priceCents: Cents | null;
  originalPriceCents: Cents | null;
  /** Computed from originalPriceCents and priceCents; never taken on trust. */
  discountPercent: number | null;
  availability: Availability;
  showStock: boolean;
  /**
   * Stock typed in Prismic (whole number ≥ 0; 0 = sold out) or null = not tracked.
   * Only a starting value: once Firestore has inventory/{sku}, Firestore is
   * authoritative (see docs/architecture.md §4.2 "Stock").
   */
  prismicStock: number | null;
  images: CatalogImage[];
  videos: CatalogVideo[];
  variants: CatalogVariant[];
  variantImages: { key: string; image: CatalogImage }[];
  sizeGuide: RichTextField;
  sizeGuideImage: CatalogImage | null;
  specifications: { label: string; value: string }[];
  materials: RichTextField;
  warrantyInfo: RichTextField;
  returnInfo: RichTextField;
  shipping: ShippingSpec;
  relatedIds: string[];
  boughtTogetherIds: string[];
  seo: Seo;
  tags: string[];
  firstPublishedAt: string;
  lastPublishedAt: string;
  /** Can be added to the cart (has SKU + price + a sellable availability). Stock is checked separately. */
  purchasable: boolean;
  issues: ContentIssue[];
}

export interface CatalogCategory {
  id: string;
  uid: string;
  title: string;
  intro: RichTextField;
  kind: "category" | "collection";
  image: CatalogImage | null;
  parentId: string | null;
  /** Products linked explicitly by editors, in editor order (only ones that exist). */
  productIds: string[];
  /** "Show all products" — membership is the whole catalog. */
  showAll: boolean;
  seo: Seo;
}

export interface BusinessHours {
  /** 0 = Sunday … 6 = Saturday (same as Date#getDay). */
  day: number;
  opens: string;
  closes: string;
}

export interface StoreSettings {
  storeName: string;
  tagline: string | null;
  logo: CatalogImage | null;
  announcement: string | null;
  announcementHref: string | null;
  company: {
    legalName: string | null;
    taxId: string | null;
    addressLine: string | null;
    city: string | null;
    state: string | null;
    postalCode: string | null;
  };
  contact: {
    email: string | null;
    phone: string | null;
    whatsappNumber: string | null;
    whatsappMessage: string | null;
    hours: BusinessHours[];
  };
  menuCategoryIds: string[];
  footerLinks: { label: string; href: string }[];
  socialLinks: { network: string; href: string }[];
  synonymGroups: string[][];
  popularSearches: string[];
  policies: { returns: RichTextField; warranty: RichTextField; shipping: RichTextField };
  seo: Seo;
  verification: { google: string | null; bing: string | null };
}

export interface PromoBanner {
  image: CatalogImage | null;
  title: string | null;
  text: string | null;
  linkLabel: string | null;
  href: string | null;
  startsAt: string | null;
  endsAt: string | null;
}

export interface Homepage {
  hero: {
    title: string | null;
    subtitle: RichTextField;
    image: CatalogImage | null;
    primary: { label: string; href: string } | null;
    secondary: { label: string; href: string } | null;
  };
  featuredProductIds: string[];
  featuredCategoryIds: string[];
  banners: PromoBanner[];
  benefits: { icon: string; title: string; text: string | null }[];
  testimonials: { quote: string; author: string; location: string | null }[];
  newsletter: { title: string | null; text: string | null };
  seo: Seo;
}

export interface ContentPage {
  id: string;
  uid: string;
  title: string;
  body: RichTextField;
  lastUpdated: string | null;
  seo: Seo;
}

export interface FaqItem {
  topic: string;
  question: string;
  answer: RichTextField;
}

export interface Faq {
  title: string;
  intro: RichTextField;
  items: FaqItem[];
  seo: Seo;
}
