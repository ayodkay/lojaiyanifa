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
    route("products/:uid/review", "routes/review.tsx"),
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
    // Customer accounts. /account/* passes the account layout's middleware (app/.server/account-guard.ts).
    route("login", "routes/login.tsx"),
    route("register", "routes/register.tsx"),
    route("forgot-password", "routes/forgot-password.tsx"),
    route("logout", "routes/logout.ts"),
    route("orders", "routes/orders-redirect.ts"),
    route("wishlist", "routes/wishlist.tsx"),
    route("account", "routes/account.tsx", { id: "account" }, [
      index("routes/account.home.tsx"),
      route("orders", "routes/account.orders.tsx"),
      route("orders/:number", "routes/account.order.tsx"),
      route("profile", "routes/account.profile.tsx"),
      route("addresses", "routes/account.addresses.tsx"),
      route("security", "routes/account.security.tsx"),
      route("privacy", "routes/account.privacy.tsx"),
      route("export", "routes/account.export.ts"),
      route("support", "routes/account.support.tsx"),
      route("support/:number", "routes/account.ticket.tsx"),
    ]),
  ]),

  // Admin (back office). Sign-in and sign-out sit outside the protected layout,
  // whose middleware checks the session before any admin loader or action runs.
  route("admin/login", "routes/admin.login.tsx"),
  route("admin/logout", "routes/admin.logout.ts"),
  route("admin", "routes/admin.tsx", { id: "admin" }, [
    index("routes/admin.home.ts"),
    route("orders", "routes/admin.orders.tsx"),
    route("orders/:number", "routes/admin.order.tsx"),
    route("support", "routes/admin.support.tsx"),
    route("support/:number", "routes/admin.ticket.tsx"),
    route("reviews", "routes/admin.reviews.tsx"),
    route("discounts", "routes/admin.discounts.tsx"),
    route("discounts/new", "routes/admin.discount.tsx", { id: "admin-discount-new" }),
    route("discounts/:id", "routes/admin.discount.tsx", { id: "admin-discount-edit" }),
    route("settings", "routes/admin.settings.tsx"),
  ]),

  // Resource routes (no UI). /robots.txt and /favicon.ico are not here: the deployed function can't answer them (the
  // Functions Framework does, with an empty 404), so Firebase Hosting serves them. The hosting predeploy hook writes
  // robots.txt (scripts/robots-txt.mjs); /favicon.ico is a redirect to /favicon.svg in firebase.json.
  route("sitemap.xml", "routes/sitemap-xml.ts"),
  route("api/search/suggest", "routes/api.search.suggest.ts"),
  route("api/products", "routes/api.products.ts"),
  route("api/cart/quote", "routes/api.cart.quote.ts"),
  route("api/wishlist", "routes/api.wishlist.ts"),
  route("api/reviews", "routes/api.reviews.ts"),
  route("health", "routes/health.ts"),
  // Files under /assets/ that Hosting doesn't have: a short 404 that nothing keeps (see the route file).
  route("assets/*", "routes/missing-asset.ts"),

  // Every other path: the store's 404 page, through the root middleware like any other route (see the route file).
  route("*", "routes/not-found.tsx"),
] satisfies RouteConfig;
