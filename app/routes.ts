import { type RouteConfig, index, layout, route } from "@react-router/dev/routes";

// Fixed content-page paths (Prismic `page` documents by UID). See app/lib/catalog/links.ts.
const CONTENT_PAGES = ["about", "privacy", "terms", "cookies", "shipping", "returns", "warranty"];

export default [
  layout("routes/store-layout.tsx", [
    index("routes/home.tsx"),
    // Shop
    route("categories", "routes/categories.tsx", { id: "categories-index" }),
    route("collections", "routes/categories.tsx", { id: "collections-index" }),
    route("categories/:uid", "routes/category.tsx", { id: "category" }),
    route("collections/:uid", "routes/category.tsx", { id: "collection" }),
    route("products/:uid", "routes/product.tsx"),
    route("search", "routes/search.tsx"),
    route("offers", "routes/offers.tsx"),
    // Shopping
    route("cart", "routes/cart.tsx"),
    route("checkout", "routes/checkout.tsx"),
    route("order-confirmation/:number", "routes/order-confirmation.tsx"),
    // Information and legal
    ...CONTENT_PAGES.map((uid) => route(uid, "routes/page.tsx", { id: `page-${uid}` })),
    route("pages/:uid", "routes/page.tsx", { id: "page-generic" }),
    route("faq", "routes/faq.tsx"),
    route("contact", "routes/contact.tsx"),
  ]),

  // Resource routes (no UI)
  route("sitemap.xml", "routes/sitemap-xml.ts"),
  route("robots.txt", "routes/robots-txt.ts"),
  route("favicon.ico", "routes/favicon-ico.ts"),
  route("api/search/suggest", "routes/api.search.suggest.ts"),
  route("api/products", "routes/api.products.ts"),
  route("api/cart/quote", "routes/api.cart.quote.ts"),
  route("healthz", "routes/healthz.ts"),
] satisfies RouteConfig;
