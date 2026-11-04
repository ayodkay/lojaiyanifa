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
5. **Missing `/assets/` files** (asked for by a page from another build, mostly
   during a deploy) fall through the `**` rewrite and get a short 404 with
   `Cache-Control: no-store` (`app/routes/missing-asset.ts`, built 2026-11-04).
   A function response without `Cache-Control` goes out as `max-age=600` and
   Firebase's CDN keeps it: the store's 404 page did that before, so a page
   loaded mid-deploy stayed broken for 10 minutes.

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
  **Customers (built 2026-11-04)**: `/register`, `/login`, `/forgot-password`, `POST /logout`, and `/account/*`
  behind its own middleware gate (`app/.server/account-guard.ts`), same mechanism with a **14-day** cookie
  (`app/.server/customer-session.ts`): no role, second factor or verified e-mail needed to sign in. Passwords never
  reach our server (the inputs have no `name`; the SDK talks to Firebase). Registration checks the form with the
  server's own schema in the browser *before* creating the Firebase sign-in, then the action saves the profile and
  consents. Sensitive changes type the password again in the browser: changing it (Firebase then revokes every session,
  so the new ID token goes to `/login`'s action, outside the gate that would refuse the old cookie), re-sending the
  verification e-mail, deleting the account (the action re-checks a < 5 min sign-in of the same UID). Sign-out
  revokes every session of the account. Admin accounts (TOTP) can't get a customer session through `/login`.
  Which orders are a customer's: those placed signed in (`customer.uid`) plus, once the e-mail is **verified**, guest
  orders with the same e-mail (otherwise anyone could register someone else's address and read their orders).
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
  cookie keeps the claims it was minted with. There is no `/admin/users` page:
  the store has a single admin account, the owner (owner decision 2026-11-03).
- **Admin 2FA (TOTP, built 2026-11-02)**: with `ADMIN_REQUIRE_MFA=true` (the
  default; production) admin sessions require the `firebase.sign_in_second_factor`
  claim. On `/admin/login` (`app/.client/firebase.ts`): an account with an
  authenticator app gets `auth/multi-factor-auth-required` after its password and
  types the 6-digit code (`getMultiFactorResolver` → `TotpMultiFactorGenerator`);
  an admin without one is refused by the server (`mfa_required`) while the page
  still holds the password sign-in, and enrols: Firebase creates the secret, the
  QR code is drawn in the browser (the secret never reaches our server), the first
  code proves the app works, then the admin signs in again with a code. An account
  whose only second factor is SMS is refused with its own message (the admin
  accepts authenticator apps only). Lost phone: `scripts/admin/reset-mfa.mjs`
  removes the account's second factors and revokes its sessions (audited as
  `mfa.reset`). Needs "Firebase Authentication with Identity Platform" with TOTP
  enabled. On `lojaiyanifa` (checked 2026-11-03), Identity Platform was on but TOTP
  was off; it was turned on that day with the owner's go (TOTP provider, 5 adjacent
  intervals, SMS left off). The Auth emulator has no TOTP, so the code exchange
  itself was verified by the owner's first sign-in on the deployed site
  (2026-11-04: enrolment, then a code; owner decision 2026-11-02).
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
| Store/payment/shipping/email settings (`/admin/settings`: Pix, delivery, opening checkout) | ✓ | read | – | – |
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
| `customers/{uid}` | Auth UID | profile (name, e-mail, phone, CPF), `marketingEmail`, `consents` (`termsAcceptedAt`, `marketingEmail: { granted, at, source }`, `history` of consent changes, max 50); `addresses/{id}` (max 10, exactly one `isDefault`). Built 2026-11-04 (`app/.server/customers.ts`) |
| `carts/{uid}` | Auth UID | signed-in cart for cross-device persistence (not built) |
| `wishlists/{uid}` | Auth UID | `productIds` (max 100). The browser keeps its own list; `/wishlist` merges both three-way against the last synced list (`app/lib/wishlist-sync.ts`, base in `li.wishlist-base.v1`) |
| `promotions/{id}` | the coupon's code (uppercase), or `auto_…` for automatic promotions | built 2026-11-04 (`app/.server/promotions.ts`, engine `app/lib/discounts.ts`): `kind` percent / fixed / free_shipping / buy_x_get_y, `scope` all / products (`requireAll` = bundle) / categories, `minSubtotalCents`, `startsAt`/`endsAt`, `maxRedemptions` + `redemptionCount`, `maxPerCustomer`, `firstOrderOnly` (by e-mail **or** CPF), `allowedEmails`, `active`. Per order: at most one products discount (the best for the customer; a tie keeps the coupon) + one free shipping. Chosen inside the order transaction with the buyer known; `redemptionCount` goes up there and down when the unpaid order is cancelled (store or expiry). Orders keep `discounts[]`, `couponCode`, `totals.discountCents` (products) and `totals.shippingCents` (charged; 0 with free shipping, `shipping.priceCents` keeps the list price) |
| `reviews/{productId}_{uid}` | one per customer and product | built 2026-11-04 (`app/.server/reviews.ts`): `rating` 1–5, `title`, `text`, `displayName`, `videoUrl` (YouTube/Vimeo, shown with the privacy-friendly players), `verifiedPurchase` (a paid order with the product, checked when sent), `status` pending → approved / rejected (`rejectReason`), `storeReply`, `helpfulCount`, `reportCount`; `votes/{uid}`, `reports/{uid}`. Signed-in customers only; editing sends it back to moderation. Photos not built (needs a Storage bucket and an upload path that strips EXIF) |
| `productStats/{productId}` | Prismic ID | `count`, `sum`, `distribution[5]` of APPROVED reviews, changed in the same transaction as the review's status. The product page reads it with the approved reviews (equality queries, no index; ≤ 200 per product) and sorts in the browser |
| `questions/{id}` | auto | product Q&A |
| `tickets/{number}` | sequential from 1001 (`counters/tickets`) | support tickets (built 2026-11-04, `app/.server/support.ts`): `status` open → answered → closed (reopenable), `topic`, contact, `orderNumber`, `customerUid` (sent signed in), `returnRequest: { reason, preference, items }` for topic "returns", `messages: [{ id, at, from: customer \| store, text, by }]` (max 100). Created by the contact form with its automatic confirmation e-mail (+ store notice) in the same transaction; answered from `/admin/support` (e-mail to the customer, audited) |
| `rateLimits/{key}` | `contact-ip-<sha256(ip\|hour)>`, `contact-email-<sha256(email\|hour)>`, `contact-all-<hour>` | hourly counters for the contact form (5 per IP, 5 per e-mail, 60 in all); `expiresAt` for a Firestore TTL policy (not set up yet) |
| `newsletter/{emailHash}` | sha256(email) | subscription + consent record |
| `mail/{id}` | auto | email outbox |
| `settings/{store,payment,shipping,tax,email}` | fixed | commerce settings, edited in `/admin/settings` (store, payment, shipping; tax and email not built). `store.checkoutOpen`: absent or false = checkout closed. Each save from the admin stamps `updatedAt` / `updatedBy` |
| `auditLogs/{id}` | auto | who did what, when: `{ at, action, actor, target, details }`; actor = `{ uid, email, role }` (app), `{ type: "system", name }` (scheduled jobs, e.g. `pix-expiry`) or `{ type: "script", name, by }` (scripts). Actions: `admin.signed_in`, `admin.signed_out`, `order.payment_confirmed`, `order.cancelled`, `order.fulfillment_updated`, `order.tracking_updated`, `order.note_added`, `order.refunded`, `settings.payment_updated` and `settings.shipping_updated` (details: the changed fields, the Pix key masked), `settings.checkout_opened`, `settings.checkout_closed`, `role.changed`, `mfa.reset` |
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
  For a fulfilment step on a partially refunded order, `status` is the step taken (the order keeps its status).
- Paid: `payment.status = "confirmed"`, `payment.confirmedAt`, `payment.confirmedBy`.
- Cancelled: `cancellation: { at, reason: "payment_not_received" | "customer_request" | "other", note, by }`;
  `by` is null when the expiry job cancelled it. `payment.status` stays `"pending"` (it was
  never confirmed). The customer's order page says the order was cancelled and how to ask for a refund.

Built 2026-11-02:
- **Pix expiry** (`expireOverdueOrders`, scheduled function `expirePixOrders` every 15 min,
  America/Sao_Paulo): orders still `pending_payment` with `expiresAt <= now` (fixed at checkout
  from `settings/payment.expiryHours`) are cancelled through the same transaction as an admin
  cancellation (`payment_not_received`, actor `system`), oldest first, 100 per run. One bad order
  doesn't stop the others; the run then throws `ExpiryRunError` so it is logged. A static Pix code
  can still be paid after the deadline: the admin page tells the team to refund it or agree a new order.
- **Fulfilment** (`app/.server/order-fulfillment.ts`): `fulfillment: { stage: unfulfilled | processing |
  shipped | delivered, carrier, trackingCode, trackingUrl, processingAt, shippedAt, deliveredAt }`.
  Steps go forward only and "processing" may be skipped; a pickup order's "shipped" means ready at
  the store and "delivered" picked up. The status follows the stage unless the order is
  `partially_refunded` (owner decision 2026-11-02: a partial refund has its own status and shipping
  goes on). Tracking (carrier, code, https link) is optional and editable once shipped. Staff may do all of it.
- **Internal notes**: `notes: [{ id, at, by, text }]` on the order, append-only, max 200, never in the customer view.
- **Refunds** (`app/.server/order-refunds.ts`, owner/admin): the money goes back through the bank app; the
  admin records `refunds: [{ id, key, at, by, amountCents, reason, note, restock: [{ sku, quantity }] }]` and
  `payment.refundedCents` (must equal the sum — a mismatch fails loudly). Full → `refunded` (ends shipping and
  further refunds); less → `partially_refunded`. Units go back on sale per item (`onHand += quantity`), at most
  what the order took from stock (its `reservations`) minus earlier restocks; by default every unit while the
  order is still in the store (delivery: before it ships; pickup: until picked up), none after (owner decision
  2026-11-02). Each form rendering carries a one-time `key`, so a double submit records one refund. A Pix paid
  twice by the customer is not an order refund: return it through the bank and add an internal note.
- **Races**: every order change is one transaction that re-checks the state. When a losing transaction fails
  without saying why (the emulator closes it: `3 INVALID_ARGUMENT: Transaction is invalid or closed`), the
  caller re-reads the order: if it changed so the action no longer applies, it reports the normal domain error
  (409 "this order changed" in the admin), otherwise the original error.
- Orders written before 2026-11-02 have no `fulfillment`, `notes`, `refunds` or `payment.refundedCents`; they read
  as unfulfilled with none (only when pending, paid or cancelled — anything else without `fulfillment` is corrupt).

## 5. Payments — static Pix (owner decision, 2026-10-31)

- The server generates a **static Pix BR Code** with the open-source library
  `pix-utils` from the store's Pix key, merchant name/city, the order total and
  `txid = order number`. The QR code is rendered server-side with `qrcode`.
- There is no gateway and no webhook: **an admin confirms each payment** in
  `/admin/orders` after seeing it in the bank account. Unpaid orders expire after
  `settings/payment.expiryHours` (default 24) and release their stock.
- **Checkout opens only when the owner opens it** in `/admin/settings` (owner decision 2026-11-03;
  `settings/store.checkoutOpen`, absent = closed). Saving the Pix or delivery settings never opens it. Opening needs
  both to be valid (a code can be built from the Pix settings; at least one delivery method), and while checkout is
  open, turning off both delivery methods is refused. Closed: customers see the "temporarily unavailable" notice and
  order creation refuses (`loadOrderDeps` checks the switch first). The page shows a R$ 1,00 test code to read in the
  bank app without paying.
- Refunds are made by the owner in their bank app and **recorded** in the admin
  (full or partial), which updates status and notifies the customer.
- Card, wallet, PayPal, Apple Pay, Google Pay and installment payments are out
  of scope for launch (owner decision). No card data is ever handled.

## 6. Shipping — Melhor Envio (owner decision, 2026-10-31)

Shipping options at checkout = Melhor Envio quotes (when configured) + store
rate rules from `settings/shipping` (flat/weight/price/location based, free
shipping thresholds) + local pickup (if enabled). Delivery estimates add the
store's handling days to the carrier's business days. CEP lookup uses ViaCEP.

## 7. Email (built 2026-11-04, `app/.server/mail/`)

- **Outbox:** each business event writes a small `mail/{id}` document (`template`, `to`, `orderNumber`, `data`) in
  the SAME transaction as the change (`queueMailInTransaction`), so an e-mail is never lost nor sent for a change
  that didn't happen, and a repeated submission (idempotent order, refund form key) queues nothing new.
  Events: order placed (customer + `store_new_order` to `MAIL_STORE_TO` when set), Pix confirmed, cancelled by the
  store or by the expiry job, shipped / ready for pickup / delivered (not "processing"), tracking changed, refunded.
- **Sender:** the scheduled function `sendMailOutbox` (every 2 minutes, one instance) — not a Firestore trigger,
  whose first deploy needs Eventarc permissions to propagate. Each due e-mail is claimed in a transaction
  (`pending → sending`, 10-minute lease: at-least-once), rendered from the order **as it is at send time**
  (`render.ts`, pt-BR, every value HTML-escaped, HTML + text), and sent over SMTP with nodemailer. A failure counts
  against the e-mail only when the server refused its recipient or its content (`sendErrorKind`): a 4xx is retried
  after 2, 4, 8, 16 minutes (5 attempts), a 5xx — or a rendering error — fails at once. Login, sender, connection,
  TLS and timeout errors are the service's: the e-mail goes back without using an attempt (tried again 5 minutes
  later), the run stops (`blocked`, logged as an error), and nothing is lost before the 72-hour expiry. E-mails older
  than 72 hours expire unsent. Without configuration nothing is claimed and each run logs an error with the count
  waiting. Live check from a dev machine: `npm run test:mail-live` (one fake order's e-mails, to `MAIL_STORE_TO` only).
- **SMTP:** Brevo's relay (`smtp-relay.brevo.com`, 587 with STARTTLS required, or 465). `MAIL_FROM` (a sender on a
  domain verified in Brevo), optional `MAIL_REPLY_TO` (default: the Prismic support e-mail), `SMTP_USER` in
  `.env.<project-id>`; the SMTP key in Secret Manager as `SMTP_PASSWORD` (the functions predeploy hook refuses it in
  an env file). The secret must exist before `sendMailOutbox` is deployed.
- **Order links in e-mails:** the checkout key is stored only as a hash, so new orders also get a random
  `customerLinkToken`, which the order page accepts like the checkout key (both compared in constant time). Orders
  created before 2026-11-04 have none; their e-mails say where to follow the order instead of linking.
- Firebase Auth sends its own verification and password-reset e-mails (its SMTP can also be pointed at Brevo in the
  Firebase console → Authentication → Templates → SMTP settings).

## 8. Configuration

Server code reads `process.env` through a zod schema (`app/.server/env.ts`) and
fails at startup with a precise message if something required is missing.
Browser code only sees `PUBLIC_*` variables. See `.env.example` for the full list.
Secrets in production live in Cloud Secret Manager (`firebase functions:secrets:set`).

Where the variables come from:

| Runs as | Source |
| --- | --- |
| `react-router dev`, scripts | `.env.local` (gitignored), loaded by `vite.config.ts` or by each script |
| Integration tests | `vitest.integration.config.ts` and the test emulators |
| `npm run preview` (functions emulator) | `build/functions/.env.local`: the build copies the root `.env.local` without the names the Firebase CLI refuses (`FIREBASE_*`; one such name made the CLI load no function at all). The emulator sets their replacements itself (`FIREBASE_CONFIG`, emulator hosts). Fixed 2026-11-03 (`emulatorEnvFile` in `scripts/functions-env.mjs`) |
| Deployed functions | `.env.<project-id>` at the repo root (`.env.lojaiyanifa`, gitignored). On every deploy the functions predeploy hook `scripts/functions-env.mjs` checks it and copies it into `build/functions/`, where the Firebase CLI loads it |
| Deployed `robots.txt` (hosting) | `SITE_URL` from the same `.env.<project-id>`. On every hosting deploy the hosting predeploy hook `scripts/robots-txt.mjs` runs the same checks and writes `build/client/robots.txt`, which Hosting serves before its rewrite to `ssr`. The app can't answer `/robots.txt` in production: the Cloud Functions Framework answers it (and `/favicon.ico`) itself with an empty 404 (verified 2026-11-03) |

Both hooks refuse a file that:

- misses a required variable;
- sets an emulator variable, `FUNCTIONS_EMULATOR`, `GOOGLE_APPLICATION_CREDENTIALS` or a token;
- uses a name the Firebase CLI reserves (`FIREBASE_*`, `X_GOOGLE_*`, `EXT_*`), which is why the web app config is
  `WEB_API_KEY` / `WEB_AUTH_DOMAIN`;
- has a `SITE_URL` that isn't an https origin, or `ADMIN_REQUIRE_MFA` other than `true`.

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
| 2026-11-02 | A partial refund gives the order its own status (`partially_refunded`); shipping goes on in `fulfillment.stage` | Owner |
| 2026-11-02 | Refunds return stock per item: by default every unit before the order leaves the store, none after | Owner |
| 2026-11-02 | TOTP is verified on a first deploy to `lojaiyanifa` with checkout closed (no payment settings); nothing deploys without the owner's go | Owner |
| 2026-11-02 | Pix expiry job every 15 minutes; automatic cancellations are `payment_not_received` by `system` | Proposed |
| 2026-11-02 | Fulfilment steps only go forward ("processing" may be skipped); pickup orders read "Pronto para retirada" / "Retirado"; tracking optional, https links only | Proposed |
| 2026-11-02 | Internal notes are append-only (no edit/delete), team-wide, max 200 per order | Proposed |
| 2026-11-02 | Refund forms carry a one-time key (double submit = one refund); refunding needs a "returned via the bank" confirmation; a duplicated Pix is a note, not a refund | Proposed |
| 2026-11-03 | Single admin account (the owner); no `/admin/users` page. Roles change only through `scripts/admin/grant-role.mjs` | Owner |
| 2026-11-03 | Deployed functions read a gitignored `.env.<project-id>`, checked and copied by the functions predeploy hook; the web app config is renamed `WEB_API_KEY` / `WEB_AUTH_DOMAIN` (the Firebase CLI reserves `FIREBASE_*`) | Owner |
| 2026-11-03 | `.firebaserc` default stays `demo-lojaiyanifa`; production is the `prod` alias (`--project prod`) | Owner |
| 2026-11-03 | The work is committed before the first deploy, so production matches a commit | Owner |
| 2026-11-03 | TOTP turned on in `lojaiyanifa`'s Auth config by an Admin SDK call (it was off): TOTP provider, 5 adjacent intervals (Google's default); SMS stays off | Owner |
| 2026-11-03 | Container images of the functions are deleted after 1 day (the Firebase CLI's default cleanup policy, applied with `--force` on the first deploy) | Owner |
| 2026-11-03 | `/robots.txt` is a static file written at deploy time from `SITE_URL` by a hosting predeploy hook (the deployed function can't serve it); the route is removed | Owner |
| 2026-11-03 | The liveness probe is `/health`, not `/healthz` (Cloud Run reserves some paths ending in `z`) | Owner |
| 2026-11-03 | `/favicon.ico` is a Hosting redirect to `/favicon.svg` (the deployed function can't serve it), written as a `regex` because this machine's Hosting emulator (Windows) never matches a `source` redirect; the route is removed | Owner |
| 2026-11-03 | Checkout opens and closes only through an explicit switch in `/admin/settings` (`settings/store.checkoutOpen`; absent = closed); saving the Pix or delivery settings never opens it | Owner |
| 2026-11-04 | A missing `/assets/` file gets a short `no-store` 404 from the function (`app/routes/missing-asset.ts`), not the store's 404 page, which Firebase sent on as `max-age=600` (a page loaded mid-deploy stayed broken for 10 minutes) | Owner |
| 2026-11-04 | Paths no route takes match a catch-all route (`app/routes/not-found.tsx`) that throws a 404, so they pass through the root middleware (security headers) and render the same 404 page | Owner |
| 2026-11-04 | E-mail through Brevo's SMTP relay (owner: "smtp which we will be using brevo.com"); outbox written in the business transaction, sent by a scheduled function every 2 minutes, rendered at send time; SMTP key in Secret Manager | Owner (Brevo) / Proposed (design) |
| 2026-11-04 | New orders get a random `customerLinkToken` for links in e-mails (the checkout key is only stored hashed) | Proposed |
| 2026-11-04 | Store texts (legal pages, about, FAQ, policy summaries) are kept in `content/prismic/` and sent with `scripts/prismic/seed-content.mjs` to the Migration Release; the owner publishes them | Proposed (owner asked for the texts and the Prismic API) |
| 2026-11-04 | Customer accounts: 14-day session cookie, sign-out revokes every session; guest orders join an account only once its e-mail is verified; deleting an account keeps its orders (legal retention) and audits the UID only; data export as JSON (`/account/export`) | Proposed |
| 2026-11-04 | Phone verification (optional item) not built: SMS sign-in is off in the project (owner, 2026-11-03), phones are checked by format and customers reach the store by WhatsApp | Proposed |
| 2026-11-04 | Support: the contact form opens a numbered ticket and answers at once by e-mail with the number (Decreto 7.962 art. 4 VI; art. 5 §4 for withdrawals); return requests are tickets with reason/preference, coming from order pages; the whole team (owner/admin/staff) reads and answers in `/admin/support`; customers' replies come back by e-mail, not into the ticket | Proposed |
| 2026-11-04 | Contact form anti-abuse: honeypot, fill time measured in the browser (≥ 3 s), hourly limits per hashed IP / e-mail / store; Cloudflare Turnstile recommended once the owner creates its keys | Proposed |
| 2026-11-04 | Discounts: one products discount per order (the best for the customer) + one free shipping, as the terms of use say; coupon limits are a counter in the promotion (two buyers can't both take the last use) released when an unpaid order is cancelled; a coupon refused at order time stops the order with the reason (409), never silently dropped; percent capped at 99 and a total of R$ 0,00 refused (a Pix needs an amount) | Proposed |
| 2026-11-04 | Not built (owner decisions needed): gift cards (selling them, balances, state rules on validity), loyalty points, referral rewards | Proposed |
| 2026-11-04 | Reviews: signed-in customers, one per product, all moderated before publication (owner/admin), never refused for being negative (the terms promise it); "Compra verificada" from a paid order; review structured data only when approved reviews exist; a Firestore failure on a product page shows "avaliações indisponíveis" (logged) instead of breaking the page | Proposed |
| 2026-11-04 | Cookie consent: the store uses only essential cookies and browser storage, so the notice informs without blocking the page; analytics/marketing stay off unless the visitor turns them on in "Preferências de cookies" (footer); any future analytics or advertising tool must check `hasConsent()` (`app/lib/consent.ts`) before loading; the choice is stored in `li.consent.v1` with a version, and raising `CONSENT_VERSION` asks everyone again | Proposed |
| 2026-11-04 | Mail sender: only a refused recipient or content counts against an e-mail; login, sender and connection errors (Brevo answers 5xx at login, e.g. 525 for an IP it doesn't authorize) put the e-mail back without using an attempt and stop the run, so a misconfiguration delays e-mails (up to 72 h) instead of failing them all for good. Found by the first live send | Owner (approved the fix) |
