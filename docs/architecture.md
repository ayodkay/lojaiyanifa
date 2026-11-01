# Loja Iyanifa — Architecture

Status: living document. Update it when a decision changes. Owner decisions are
logged at the bottom with dates.

## 1. System overview

```
Customer (browser)
   │  HTTPS
   ▼
Cloudflare ── DNS, TLS edge, WAF, rate limiting, bot protection, Turnstile, edge cache
   │  (proxied, SSL "Full (strict)")
   ▼
Firebase Hosting ── serves build/client (/assets/* immutable), CDN cache
   │  every other path is rewritten to:
   ▼
Cloud Function `ssr` (southamerica-east1, Node 22)
   │  server/app.ts → React Router request handler (SSR pages + /api resource routes)
   ├──► Prismic Content API ── catalog + editorial content (read-only at runtime)
   ├──► Firestore (Admin SDK) ── stock, carts, orders, customers, reviews, settings…
   ├──► Firebase Auth (Admin SDK) ── verify session cookies, custom claims
   ├──► Melhor Envio API ── freight quotes, labels, tracking
   └──► SMTP provider ── transactional email (via Firestore outbox)

Background Cloud Functions (same bundle): mail sender, Pix expiry, abandoned
cart, low-stock alerts. Firebase Auth (client SDK) handles sign-in in the browser.
```

### Who owns what

| Concern | Owner | Notes |
| --- | --- | --- |
| DNS, edge TLS, WAF, rate limits, bot/spam protection, edge HTML cache | **Cloudflare** | Origin is Firebase Hosting. Cloudflare never runs app logic. |
| Origin TLS cert, static assets, origin CDN, routing to functions | **Firebase Hosting** | Cert provisioned by Firebase (see docs/cloudflare.md for the proxy gotcha). |
| Rendering, APIs, business rules, auth checks | **`ssr` Cloud Function** | One bundle; React Router loaders/actions/resource routes. |
| Product catalog & editorial content (names, descriptions, images, prices, variants, categories, pages, homepage, settings) | **Prismic** | Source of truth. Never duplicated as a hard-coded catalog. |
| Transactional data (stock, carts, orders, payments, customers, reviews, tickets, coupons, logs) | **Firestore** | Keyed to Prismic by **document ID** (stable) and **SKU**. |
| Identity (customers + admins) | **Firebase Auth** | Admin roles in custom claims. |

Never configure the same responsibility twice (e.g. no redirects in both
Cloudflare and firebase.json for the same path; HTML caching rules live in the
app's `Cache-Control` headers, which both CDNs honour).

## 2. Rendering and caching rules

1. **Public pages** (home, category, collection, product, search, content pages)
   render the same HTML for everyone. They never read the session cookie
   during SSR. Header state that depends on the visitor (cart count, signed-in
   name, wishlist) hydrates in the browser.
   - `Cache-Control: public, max-age=0, s-maxage=60, stale-while-revalidate=300`
     (Firebase CDN keeps it ≤ 60 s).
   - `Cloudflare-CDN-Cache-Control: max-age=86400` (Cloudflare edge keeps it up
     to a day; purged on every Prismic publish via webhook).
2. **Private pages** (`/account*`, `/orders*`, `/checkout`, `/cart`,
   `/order-confirmation*`, `/admin*`) and all `/api/*` mutations:
   `Cache-Control: private, no-store`.
3. **Live data on public pages** (stock levels, ratings counts) is fetched by the
   browser from small `no-store` endpoints, so cached HTML never shows stale stock.
4. Firebase Hosting only forwards **one cookie, `__session`**, to the function.
   The app uses no other server-readable cookie.

## 3. Authentication and authorization

- Sign-in happens in the browser with the Firebase Auth JS SDK (email/password,
  email verification, password reset; Google sign-in optional).
- After sign-in the browser POSTs the ID token to `/api/session`. The server
  verifies it (`auth_time` must be < 5 min old), creates a Firebase **session
  cookie** (14 days) and sets it as `__session`
  (`HttpOnly; Secure; SameSite=Lax; Path=/`).
- Private loaders/actions verify `__session` with
  `verifySessionCookie(cookie, checkRevoked = true)`. Logout clears the cookie
  and revokes refresh tokens.
- **Roles** are Firebase custom claims: `role: "owner" | "admin" | "staff"`.
  Customers have no role claim. The first owner is granted with
  `scripts/admin/grant-role.mjs`; afterwards owners manage roles in `/admin/users`.
- **Admin 2FA**: in production, admin routes require the session to have been
  created with a second factor (`firebase.sign_in_second_factor` claim). TOTP MFA
  requires "Firebase Authentication with Identity Platform" on the project.
- **CSRF**: `SameSite=Lax` cookie + every non-GET request must pass a
  same-origin check (`Sec-Fetch-Site` / `Origin` against `SITE_URL`). Webhooks are
  exempt and authenticate with their own shared secret.

| Capability | owner | admin | staff | customer |
| --- | :-: | :-: | :-: | :-: |
| View/update orders, add notes, confirm Pix | ✓ | ✓ | ✓ | own orders (read) |
| Cancel orders, record refunds | ✓ | ✓ | – | – |
| Inventory adjustments | ✓ | ✓ | ✓ | – |
| Discounts, reviews moderation, customers | ✓ | ✓ | – | – |
| Store/payment/shipping/email settings | ✓ | read | – | – |
| Admin users and roles | ✓ | – | – | – |

## 4. Data model

### 4.1 Prismic (catalog and content)

Existing types (created by the owner): `products`, `product_category`
(and `product`, a disabled duplicate — left untouched). Models are versioned in
`customtypes/` and pushed additively with `scripts/prismic/push-models.mjs`.

Content rules the app enforces (and reports in the admin "content health" view):
- A product is **purchasable** only if it has a SKU and a price > 0.
- Variants inherit the product price/availability when their own field is empty.
- A discount badge is computed from `original_price` and `price`; a
  `discount_percentage` that disagrees with them is flagged, never displayed.
- Freight quotes need weight and dimensions; products without them can't be
  quoted by Melhor Envio (flagged).
- A product's primary category is the first category whose product list links it.

### 4.2 Firestore (transactional)

All money is stored as **integer centavos** (BRL). All timestamps are Firestore
`Timestamp`s. Collection names:

| Collection | Key | Purpose |
| --- | --- | --- |
| `inventory/{encodeURIComponent(sku)}` | SKU | `sku`, `onHand`, `reserved`, `lowStockThreshold`, `productId`; `movements/{id}` history (ID encoding: a "/" in an editor-typed SKU would otherwise become a sub-path; ordinary SKUs are unchanged) |
| `orders/{number}` | sequential number | order snapshot, status, totals, addresses, shipping, Pix, timeline, notes |
| `counters/orders` | – | next order number (transaction) |
| `customers/{uid}` | Auth UID | profile, consents, notification prefs; `addresses/{id}` |
| `carts/{uid}` | Auth UID | signed-in cart for cross-device persistence |
| `wishlists/{uid}` | Auth UID | product IDs |
| `coupons/{CODE}` | code | rules, limits, schedule; `redemptions/{orderNumber}` |
| `reviews/{id}` | auto | rating, text, media, status, verified purchase; `votes/{uid}`, `reports/{uid}` |
| `productStats/{productId}` | Prismic ID | rating aggregates, units sold |
| `questions/{id}` | auto | product Q&A |
| `tickets/{id}` | auto | support tickets and messages |
| `newsletter/{emailHash}` | sha256(email) | subscription + consent record |
| `mail/{id}` | auto | email outbox |
| `settings/{store,payment,shipping,tax,email}` | fixed | commerce settings edited in admin |
| `auditLogs/{id}` | auto | who did what, when (admin actions) |
| `redirects/{encodedPath}` | path | old URL → new URL (301) |

#### Stock

Implemented in `app/.server/inventory.ts` (reads) and `app/lib/cart/quote.ts` (rules).

| Situation for a SKU | Available to sell |
| --- | --- |
| `inventory/{sku}` exists | `onHand − reserved` (never below 0). Firestore is authoritative. |
| No document, stock typed in Prismic (`stock_quantity` / `variant_stock`, whole number ≥ 0) | That number. The first order creates the document from it. |
| No document, no Prismic stock | **Not tracked**: no quantity limit; Prismic availability alone decides. |

- Limits apply only to availability **In stock**. **Pre-order** and **Backorder** can be
  ordered beyond stock.
- A negative or fractional Prismic stock is ignored (not tracked) and reported as the
  content issue `invalid_stock`.
- Corrupt counts in Firestore (non-integers, negative `reserved`) make the request fail
  loudly instead of guessing.

### 4.3 Order lifecycle

```
pending_payment ──(admin confirms Pix)──► paid ──► processing ──► shipped ──► delivered
      │                                   │            │             │
      └─(expired / cancelled)─► cancelled  └────────────┴─(refund)───► refunded / partially_refunded
```
- Creating an order **reserves** stock (`reserved += qty`) in the same transaction.
- `paid` converts the reservation into a sale (`onHand -= qty`, `reserved -= qty`).
- `cancelled` (incl. Pix expiry) releases the reservation.
- Every transition appends to `timeline` and writes an audit log entry.

## 5. Payments — static Pix (owner decision, 2026-10-31)

- The server generates a **static Pix BR Code** with the open-source library
  `pix-utils` from the store's Pix key, merchant name/city, the order total and
  `txid = order number`. The QR code is rendered server-side with `qrcode`.
- There is no gateway and no webhook: **an admin confirms each payment** in
  `/admin/orders` after seeing it in the bank account. Unpaid orders expire after
  `settings/payment.expiryHours` (default 24) and release their stock.
- Refunds are made by the owner in their bank app and **recorded** in the admin
  (full or partial), which updates status and notifies the customer.
- Card, wallet, PayPal, Apple Pay, Google Pay and installment payments are out
  of scope for launch (owner decision). No card data is ever handled.

## 6. Shipping — Melhor Envio (owner decision, 2026-10-31)

Shipping options at checkout = Melhor Envio quotes (when configured) + store
rate rules from `settings/shipping` (flat/weight/price/location based, free
shipping thresholds) + local pickup (if enabled). Delivery estimates add the
store's handling days to the carrier's business days. CEP lookup uses ViaCEP.

## 7. Email

Business events write a document to the `mail` outbox; a Firestore-triggered
function renders the template and sends it over SMTP (nodemailer), recording
`sent`/`failed` and retrying. Firebase Auth sends its own verification and
password-reset emails.

## 8. Configuration

Server code reads `process.env` through a zod schema (`app/.server/env.ts`) and
fails at startup with a precise message if something required is missing.
Browser code only sees `PUBLIC_*` variables. See `.env.example` for the full list.
Secrets in production live in Cloud Secret Manager (`firebase functions:secrets:set`).

## 9. Error handling

- Expected failures (validation, out of stock, freight unavailable) are returned
  as typed results and shown next to the field or action that caused them.
- Unexpected errors bubble to route `ErrorBoundary`s and are logged with stack
  traces (Cloud Logging → Error Reporting). No silent fallbacks.
- Missing configuration fails loudly in admin (e.g. "Pix key not configured"
  blocks checkout with an explicit message instead of producing a broken code).

## 10. Repository layout

```
app/                 React Router app (routes, components, lib)
  .server/           server-only modules (Admin SDK, env, sessions, domain services)
  .client/           browser-only modules (Firebase JS SDK)
  lib/               pure, isomorphic logic (money, pricing, cart, search) — unit tested
server/              Cloud Functions entry + Fetch adapter
customtypes/         Prismic models (JSON) pushed with scripts/prismic/push-models.mjs
scripts/             build + maintenance scripts (Prismic, admin roles)
docs/                architecture, operations, Cloudflare, security, checklists
tests/               unit + integration (emulators) + e2e
```

## 11. Decision log

| Date | Decision | By |
| --- | --- | --- |
| 2026-10-31 | React Router (v8.5) SSR on a Cloud Function behind Firebase Hosting; Cloudflare in front | Owner |
| 2026-10-31 | Payments: static Pix only, open-source BR Code generation, manual confirmation | Owner |
| 2026-10-31 | Shipping: Melhor Envio | Owner |
| 2026-10-31 | Prismic models may be extended additively via the Custom Types API | Owner |
| 2026-10-31 | Stock lives in Firestore (transactional); Prismic stock fields seed it once | Proposed, not objected |
| 2026-10-31 | Brand assets will be supplied by the owner; UI uses neutral design tokens until then | Owner |
| 2026-10-31 | npm audit: 6 moderate advisories in firebase-admin's transitive deps deferred (docs/security.md) | Owner |
| 2026-11-01 | Delivery at launch: one flat rate for all of Brazil + local pickup (Mercadão de Madureira – Anexo, Galeria K, Lojas 219-220, Rio de Janeiro – RJ, 21360-201); no free shipping; Melhor Envio later. Settings in Firestore `settings/shipping` | Owner |
| 2026-11-01 | CPF required at checkout, and at account creation | Owner |
| 2026-11-01 | Guest order link = `/order-confirmation/:number?t=<checkout key>`; only the key's SHA-256 is stored; the same key makes order creation idempotent | Proposed |
