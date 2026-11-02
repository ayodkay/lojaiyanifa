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
- **Admin sign-in (built 2026-11-02, `app/.server/session.ts`)**: `/admin/login`
  signs in with the JS SDK (in-memory persistence: nothing stays on the device)
  and posts the fresh ID token to its own action. The server verifies it with
  revocation checking, requires `auth_time` < 5 min, then admits the user only
  if the `role` claim is owner/admin/staff, the e-mail is **verified** (blocks
  someone pre-registering the owner's address and inheriting a role granted to
  it), and — when `ADMIN_REQUIRE_MFA=true` — the sign-in used a second factor.
  It then sets a Firebase **session cookie** in `__session`
  (`HttpOnly; Secure; SameSite=Lax; Path=/`) valid **12 hours** for admins.
  Customers (not built yet) will get their own sign-in route; 14-day sessions planned.
- **Every `/admin` request** passes the admin layout's middleware
  (`app/.server/admin-guard.ts`), which runs before any admin loader or action
  (a parent loader would not do: loaders run in parallel). It calls
  `verifySessionCookie(cookie, checkRevoked = true)`; no/expired/revoked cookie →
  `/admin/login?redirectTo=…`; valid session without admin access → 403. Each
  action also checks its capability (`requireCapability`). firebase-admin always
  checks revocation against the emulator, so a unit test pins the `true` flag.
- **Sign-out** (`POST /admin/logout`) revokes all of the account's sessions and
  refresh tokens (every device) and clears the cookie. A GET never signs out.
- **Roles** are Firebase custom claims: `role: "owner" | "admin" | "staff"`.
  Customers have no role claim. Roles are granted with
  `scripts/admin/grant-role.mjs` (emulator by default; `--production --project`
  for a real project), which also revokes the account's sessions — a live
  cookie keeps the claims it was minted with. `/admin/users` comes later.
- **Admin 2FA**: with `ADMIN_REQUIRE_MFA=true` (the default; production) admin
  sessions require the `firebase.sign_in_second_factor` claim — verified with an
  emulator SMS factor. The TOTP enrolment/sign-in screens are not built yet
  (owner decision 2026-11-01: build them on the real project, since the Auth
  emulator only implements SMS second factors). TOTP MFA requires "Firebase
  Authentication with Identity Platform" on the project. Until the screens
  exist, production admin sign-in is refused (fail-closed).
- **Emulator guard**: pointed at an emulator the Admin SDK accepts unsigned
  tokens, so a production build refuses to start with `FIRESTORE_EMULATOR_HOST` /
  `FIREBASE_AUTH_EMULATOR_HOST` set, except inside the functions emulator.
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
| `auditLogs/{id}` | auto | who did what, when: `{ at, action, actor, target, details }`; actor = `{ uid, email, role }` (app) or `{ type: "script", name, by }` (scripts). Actions: `admin.signed_in`, `admin.signed_out`, `order.payment_confirmed`, `order.cancelled`, `role.changed` |
| `checkoutAttempts/{sha256(key)}` | checkout key hash | idempotency: maps a checkout attempt to its order number |
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

Built so far (2026-11-02, `app/.server/admin-orders.ts`): `pending_payment → paid`
(admin confirms the Pix) and `pending_payment → cancelled` (owner/admin, with a
reason). Each is ONE transaction that re-reads the order (must still be pending,
so two admins or a future expiry job can't settle it twice), checks every reserved
SKU's stock document covers the reservation (corrupt counts fail loudly, nothing
written), moves the stock, updates the order and writes the audit entry.
- Timeline entry: `{ at, status, by: "customer" | "admin" | "system", actor: { uid, email } | null, note }`.
- Paid: `payment.status = "confirmed"`, `payment.confirmedAt`, `payment.confirmedBy`.
- Cancelled: `cancellation: { at, reason: "payment_not_received" | "customer_request" | "other", note, by }`;
  `payment.status` stays `"pending"` (it was never confirmed). The customer's order
  page says the order was cancelled and how to ask for a refund.
- Not built yet: processing/shipped/delivered, refunds, the Pix expiry job.

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
| 2026-11-01 | Admin sessions last 12 hours (customers keep the planned 14 days) | Owner |
| 2026-11-01 | Admin 2FA: the server requires a second factor now (`ADMIN_REQUIRE_MFA`); TOTP screens are built on the real Firebase project; production admin sign-in is refused until then | Owner |
| 2026-11-02 | Admin accounts need a verified e-mail; admin sign-in posts the ID token to the `/admin/login` action (no generic `/api/session`) | Proposed |
| 2026-11-02 | Admin orders list defaults to "Aguardando pagamento" (the Pix work queue); staff may confirm Pix but not cancel (role table above) | Proposed |
