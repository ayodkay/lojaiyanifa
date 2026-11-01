// Adds the fields and types the storefront needs to customtypes/*.json.
// Only adds: existing tabs/fields are never modified (push-models.mjs enforces it).
// Idempotent: re-running leaves files unchanged.
//   node scripts/prismic/model-additions.mjs && node scripts/prismic/push-models.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

// --- field builders (shapes copied from the existing Prismic models) ---------
const text = (label, placeholder = "") => ({ type: "Text", config: { label, placeholder } });
const number = (label, placeholder = "") => ({ type: "Number", config: { label, placeholder } });
const rich = (label, placeholder, { single = false, blocks } = {}) => ({
  type: "StructuredText",
  config: {
    label,
    placeholder,
    [single ? "single" : "multi"]: blocks ?? (single ? "paragraph,strong,em,hyperlink" : "paragraph,strong,em,hyperlink,list-item,o-list-item"),
    allowTargetBlank: true,
  },
});
const bool = (label, placeholderTrue, placeholderFalse, defaultValue = false) => ({
  type: "Boolean",
  config: { label, default_value: defaultValue, placeholder_true: placeholderTrue, placeholder_false: placeholderFalse },
});
const select = (label, options, defaultValue) => ({
  type: "Select",
  config: { label, placeholder: "Choose…", options, ...(defaultValue ? { default_value: defaultValue } : {}) },
});
const image = (label) => ({ type: "Image", config: { label, constraint: {}, thumbnails: [] } });
const anyLink = (label) => ({ type: "Link", config: { label, allowTargetBlank: true } });
const webLink = (label) => ({ type: "Link", config: { label, select: "web", allowTargetBlank: true } });
const docLink = (label, customtypes) => ({ type: "Link", config: { label, select: "document", customtypes } });
const group = (label, fields) => ({ type: "Group", config: { label, repeat: true, fields } });
const timestamp = (label) => ({ type: "Timestamp", config: { label } });
const date = (label) => ({ type: "Date", config: { label } });
const uid = (label, placeholder) => ({ type: "UID", config: { label, placeholder } });

const seoTab = () => ({
  meta_title: text("SEO title (optional)", "Defaults to the page title; keep under 60 characters"),
  meta_description: text("SEO description (optional)", "Keep under 160 characters"),
  meta_image: image("Social sharing image (optional, 1200×630)"),
});

// --- helpers -----------------------------------------------------------------
function load(id) {
  return JSON.parse(readFileSync(join("customtypes", id, "index.json"), "utf8"));
}
function save(type) {
  const dir = join("customtypes", type.id);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "index.json"), `${JSON.stringify(type, null, 2)}\n`);
}
function addFields(type, tab, fields) {
  type.json[tab] ??= {};
  for (const [key, def] of Object.entries(fields)) {
    if (!(key in type.json[tab])) type.json[tab][key] = def;
  }
}
function addGroupFields(type, tab, groupKey, fields) {
  const g = type.json[tab]?.[groupKey];
  if (!g || g.type !== "Group") throw new Error(`${type.id}: ${tab} › ${groupKey} is not a Group`);
  for (const [key, def] of Object.entries(fields)) {
    if (!(key in g.config.fields)) g.config.fields[key] = def;
  }
}
function createIfMissing(type) {
  if (existsSync(join("customtypes", type.id, "index.json"))) return;
  save(type);
}

// --- products (existing) -----------------------------------------------------
const products = load("products");
addFields(products, "Main", {
  search_keywords: text("Search keywords and synonyms (optional)", "Comma-separated, e.g. cowrie, dilogun, merindilogun"),
});
addFields(products, "Details", {
  specifications: group("Product specifications", {
    spec_label: text("Label", "e.g. Origin"),
    spec_value: text("Value", "e.g. Nigeria"),
  }),
  materials: rich("Materials and ingredients (where applicable)", "What it is made of"),
  warranty_info: rich("Warranty information (optional)", "Leave empty to show the store warranty policy"),
  return_info: rich("Return policy notes (optional)", "Leave empty to show the store return policy"),
});
addFields(products, "Shipping", {
  weight_grams: number("Product weight, packed (grams)", "Needed for freight quotes, e.g. 350"),
  length_cm: number("Package length (cm)", "e.g. 20"),
  width_cm: number("Package width (cm)", "e.g. 15"),
  height_cm: number("Package height (cm)", "e.g. 5"),
  pickup_only: bool("Local pickup only", "Customer must pick it up", "Can be shipped"),
});
addGroupFields(products, "Variants", "variants", {
  variant_weight_grams: number("Variant weight, packed (grams, optional)", "Leave empty to use the product weight"),
});
addFields(products, "Related", {
  related_products: group("Related products", { product: docLink("Product", ["products"]) }),
  bought_together: group("Frequently bought together", { product: docLink("Product", ["products"]) }),
});
addFields(products, "SEO", seoTab());
save(products);

// --- product_category (existing) ---------------------------------------------
const category = load("product_category");
addFields(category, "Main", {
  kind: select("Type", ["Category", "Collection"], "Category"),
  image: image("Category image"),
  parent_category: docLink("Parent category (makes this a subcategory)", ["product_category"]),
});
addFields(category, "SEO", seoTab());
save(category);

// --- homepage (new, singleton) -------------------------------------------------
createIfMissing({
  id: "homepage",
  label: "Homepage",
  repeatable: false,
  status: true,
  format: "custom",
  json: {
    Hero: {
      hero_title: text("Hero title", "Main promotional message"),
      hero_subtitle: rich("Hero subtitle", "Supporting sentence", { single: true }),
      hero_image: image("Hero image"),
      hero_cta_label: text("Main button label", "e.g. Ver produtos"),
      hero_cta_link: anyLink("Main button link"),
      hero_secondary_cta_label: text("Second button label (optional)"),
      hero_secondary_cta_link: anyLink("Second button link (optional)"),
    },
    Merchandising: {
      featured_products: group("Featured products", { product: docLink("Product", ["products"]) }),
      featured_categories: group("Featured categories", { category: docLink("Category", ["product_category"]) }),
      promo_banners: group("Promotional banners", {
        image: image("Banner image"),
        title: text("Title"),
        text: text("Text"),
        link_label: text("Link label"),
        link: anyLink("Link"),
        starts_at: timestamp("Show from (optional)"),
        ends_at: timestamp("Show until (optional)"),
      }),
    },
    Trust: {
      benefits: group("Benefits (e.g. secure payment, shipping)", {
        icon: select("Icon", ["shipping", "secure", "pix", "support", "authentic", "returns"], "shipping"),
        title: text("Title"),
        text: text("Text"),
      }),
      testimonials: group("Testimonials (real customers only)", {
        quote: text("Quote"),
        author: text("Customer name"),
        location: text("City / state (optional)"),
      }),
    },
    Newsletter: {
      newsletter_title: text("Newsletter title", "e.g. Receba novidades"),
      newsletter_text: text("Newsletter text"),
    },
    SEO: seoTab(),
  },
});

// --- settings (new, singleton) -------------------------------------------------
createIfMissing({
  id: "settings",
  label: "Store settings",
  repeatable: false,
  status: true,
  format: "custom",
  json: {
    Store: {
      store_name: text("Store name", "Loja Iyanifa"),
      tagline: text("Tagline (optional)"),
      logo: image("Logo"),
      announcement: text("Announcement bar text (optional)"),
      announcement_link: anyLink("Announcement link (optional)"),
    },
    Company: {
      legal_name: text("Legal name (razão social)"),
      tax_id: text("CNPJ or CPF", "Shown in the footer, as required for online stores in Brazil"),
      address_line: text("Street address"),
      city: text("City"),
      state: text("State (UF)", "e.g. SP"),
      postal_code: text("CEP", "e.g. 01001-000"),
    },
    Contact: {
      support_email: text("Support email"),
      phone: text("Phone (optional)"),
      whatsapp_number: text("WhatsApp number", "Country + area code, digits only, e.g. 5511999999999"),
      whatsapp_message: text("WhatsApp default message", "e.g. Olá! Vim pelo site da Loja Iyanifa."),
      business_hours: group("Business hours", {
        day: select("Day", ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]),
        opens: text("Opens (HH:MM)", "09:00"),
        closes: text("Closes (HH:MM)", "18:00"),
      }),
    },
    Navigation: {
      menu_categories: group("Main menu categories (in order)", { category: docLink("Category", ["product_category"]) }),
      footer_links: group("Extra footer links", { label: text("Label"), link: anyLink("Link") }),
      social_links: group("Social media", {
        network: select("Network", ["Instagram", "Facebook", "TikTok", "YouTube", "WhatsApp", "X", "Pinterest"]),
        url: webLink("Profile URL"),
      }),
    },
    Search: {
      synonym_groups: group("Search synonyms", {
        terms: text("Terms that mean the same thing", "Comma-separated, e.g. búzios, cowrie, dilogun"),
      }),
      popular_searches: group("Suggested searches", { term: text("Search term") }),
    },
    Policies: {
      return_policy_summary: rich("Return policy summary (product pages)", "Two or three sentences"),
      warranty_summary: rich("Warranty summary (product pages)", "Two or three sentences"),
      shipping_summary: rich("Shipping summary (product pages)", "Two or three sentences"),
    },
    SEO: {
      default_meta_title: text("Default SEO title"),
      default_meta_description: text("Default SEO description"),
      default_meta_image: image("Default social sharing image (1200×630)"),
      google_site_verification: text("Google Search Console verification code (optional)"),
      bing_site_verification: text("Bing Webmaster verification code (optional)"),
    },
  },
});

// --- page (new, repeatable): about, privacy, terms, cookies, shipping, returns, warranty
createIfMissing({
  id: "page",
  label: "Content page",
  repeatable: true,
  status: true,
  format: "custom",
  json: {
    Main: {
      uid: uid("URL slug", "about, privacy, terms, cookies, shipping, returns, warranty…"),
      title: text("Title"),
      body: rich("Content", "", {
        blocks: "paragraph,heading2,heading3,heading4,strong,em,hyperlink,list-item,o-list-item,image,embed",
      }),
      last_updated: date("Last updated (shown on legal pages)"),
    },
    SEO: seoTab(),
  },
});

// --- faq (new, singleton) --------------------------------------------------------
createIfMissing({
  id: "faq",
  label: "FAQ",
  repeatable: false,
  status: true,
  format: "custom",
  json: {
    Main: {
      title: text("Title", "Perguntas frequentes"),
      intro: rich("Intro (optional)", "", { single: true }),
      items: group("Questions", {
        topic: select("Topic", ["Orders", "Payment", "Shipping", "Returns & refunds", "Products", "Account"], "Orders"),
        question: text("Question"),
        answer: rich("Answer", ""),
      }),
    },
    SEO: seoTab(),
  },
});

console.log("Model additions written to customtypes/. Next: node scripts/prismic/push-models.mjs");
