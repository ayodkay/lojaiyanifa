# Progress log and handoff

Canonical requirement status lives in `ecommerce_master_build_prompt.md`
(updated from `docs/checklist-status.json` with `node scripts/checklist-update.mjs`).
This file records what was done per session, how it was verified, and what is blocked.

## Session 1 — 2026-10-31

### Done and verified
- **Repo audit**: Vite+React starter (no app code) + two Prismic scripts with hardcoded tokens.
- **Secrets**: tokens moved to gitignored `.env.local`; scripts read env. Verified no token remains in any tracked file.
- **Encoding bug**: reproduced (Windows `curl.exe` re-encodes argv → `á` sent as byte `e1` → Prismic stored U+FFFD) and fixed in `scripts/prismic/add-product.sh` (`--data-binary @file`).
- **12 damaged product names** repaired via Migration API (`scripts/prismic/fix-product-names.mjs`, dry-run → apply). ⚠️ They sit in a **Migration Release the owner must publish**; afterwards the dry-run should report 0 repairs.
- **Prismic models** versioned in `customtypes/`, extended additively (products +20 fields, product_category +6; new: homepage, settings, page, faq) with `scripts/prismic/{pull,push}-models.mjs`. Push refuses removals/changes (guard tested) and verifies after pushing.
- **Architecture**: React Router 8.5 SSR in a Cloud Function (`server/app.ts`, custom Fetch adapter using `req.rawBody`) behind Firebase Hosting. Verified in the Hosting + Functions emulators (SSR, health, 404).
- **Data layer**: typed Prismic codegen, pure mappers + catalog queries + search (MiniSearch), 36 unit tests (`npm test`), mutation-checked.
- **Storefront**: layout (header w/ search combobox + mega menu + mobile dialog, footer w/ trust strip), home, categories/collections (+ all), product page, search, offers, content pages, FAQ, contact, sitemap.xml, robots.txt, favicon, security headers + CSRF middleware, cache headers. Verified against the live Prismic repository on the dev server and visually on desktop.

### Not verified yet
- Mobile layout visually (window resize had no effect in the browser tool).
- `/assets/**` immutable cache header (Hosting emulator didn't apply firebase.json headers; check after first deploy with `curl -I`).
- Anything that needs Prismic content the owner hasn't created yet (categories, prices, images, homepage, settings, pages, FAQ).

### Owner actions needed
1. Publish the Migration Release with the 12 repaired names (Prismic → Migration Releases).
2. In Prismic: add prices, images, weight/dimensions to products; create categories; fill **Store settings** (company data, CNPJ/CPF, address, contact, WhatsApp, hours); create the **Homepage** and **FAQ**; create pages `about, privacy, terms, cookies, shipping, returns, warranty` (legal texts need the owner's/lawyer's review).
3. Provide brand assets (logo, colours, fonts) — see `docs/brand.md`.
4. Later: Firebase project (Blaze), Melhor Envio sandbox token, SMTP provider, domain on Cloudflare, Pix key + merchant name/city.

### Next (in order) — as planned at the end of session 1
Firebase Admin + emulators → cart (`/api/cart/quote`, `/cart`) → Pix module (BR Code + QR, tested against the BCB example) → orders (transactional stock reservation) → checkout → order confirmation → auth/session → admin (orders/confirm Pix, inventory, settings) → shipping (Melhor Envio + rates + pickup) → email outbox → account → reviews/Q&A/newsletter/support/consent/analytics → docs (operations, Cloudflare, deploy).

## Session 2 — 2026-11-01

### Why session 1 ended
Session 1 was **not** interrupted mid-work: at 19:24 it was blocked (Firestore
emulator: "firebase-tools no longer supports Java version before 21") and waiting
for the owner's answer. At 22:10 WebStorm's JVM crashed
(`EXCEPTION_ILLEGAL_INSTRUCTION`, dump `C:\Users\Predator\java_error_in_webstorm_24364.log`),
which killed Claude Code running in its terminal. All session-1 edits were on disk.

### Environment facts (local machine)
- **Java 21** installed by the owner (`C:\Program Files\Microsoft\jdk-21.0.13.21-hotspot`).
  Machine PATH lists it before JDK 17. ⚠️ The *User* `JAVA_HOME` still points to JDK 17
  (owner to update; firebase-tools uses PATH, so the emulators are unaffected).
- **Firestore emulator port is 8180**, not 8080: Docker Desktop (`com.docker.backend.exe`)
  holds 127.0.0.1:8080 on this machine. Only `firebase.json` referenced the port.
- An **orphaned emulator from session 1** (PID 20092 + child 27600,
  `emulators:start --only functions,hosting`, started 2026-10-31 18:39) still holds
  ports 4000/4400/4500. The owner chose not to have it stopped. Until it is,
  `npm run emulators` fails ("Could not start Emulator UI, port taken");
  `firebase emulators:exec` (no UI) works and is what tests use.

### Done and verified
- Lint error fixed: `app/components/listing.tsx` called `useLocation()` conditionally
  (rules-of-hooks). `npm run lint` → 0 errors (39 warnings, 35 are route modules
  exporting loaders/meta — expected for React Router).
- **Firebase Admin** (`app/.server/firebase.ts`): lazy app; in development/tests it
  refuses to run without the emulator hosts, so a dev machine can't write to a real
  project. Emulator variables added to `.env.example` and the local `.env.local`.
- **Integration tests** (`npm run test:integration`, `vitest.integration.config.ts`,
  `tests/integration/`): 3 passing — Admin SDK writes reach the emulator; 10 concurrent
  transactions on one counter hand out 1–10 exactly once (the order-number pattern);
  Auth emulator users.
- **Stock in the catalog model**: `prismicStock` from Prismic `stock_quantity` / `variant_stock`
  (0 = sold out; negative or fractional → `invalid_stock` content issue). Rules: docs/architecture.md §4.2 "Stock".
- **Cart quote** (`app/lib/cart/quote.ts`, pure): prices only from the catalog, merges duplicate SKUs,
  stock limits for tracked in-stock SKUs, unavailable lines excluded from totals, recommendations.
  13 unit tests, mutation-checked (removing the stock limit / accepting foreign SKUs makes tests fail).
- **Inventory reads** (`app/.server/inventory.ts`): one `getAll` round trip; SKU document IDs are
  URL-encoded ("/" in a SKU); corrupt counts fail loudly. 5 emulator tests.
- **`POST /api/cart/quote` + `/cart`**: verified on a dev server (port 5174) against the real Prismic
  content: 16/16 live API checks (400s for bad input, 403s cross-site, `private, no-store`, SSR never
  claims "empty"), and in Chrome (unavailable lines, per-line and bulk removal, persistence on reload).
- Header badge labels: "1 item" / "N itens".

### Not verified yet (session 2)
- Cart happy path in the browser (prices, quantities, totals, stock auto-adjust): no product in
  Prismic has a price yet.
- Mobile layout: the automation browser window can't be resized (viewport stays 1536 px).

### Found in session 2
- `pix-utils` 2.8.2 accepts an empty Pix key, a txid containing "-" and negative amounts, and it
  uppercases the merchant name (valid; the BCB example's CRC differs only because of that). Our Pix
  module must validate its inputs before calling it.
- Socket states are misreported on this machine (working listeners show as FIN_WAIT_1 / CLOSED in
  netstat): probe ports over HTTP instead of trusting netstat.
- Session-1 orphan **dev server** (PID 33028, port 5173, started 2026-10-31 19:06) still runs and now
  returns 500 ("Failed to load url /app/routes/cart.tsx"): it cached the moment `routes.ts` referenced
  `cart.tsx` before the file existed. A restart fixes it (owner's call; touching routes.ts didn't).
- Vite colours its output: match log lines only after stripping ANSI codes.

### Next
Pix module (validated BR Code + QR) → orders (one transaction: order counter + stock reservation) →
checkout → order confirmation → auth/session → admin → shipping → email → account → …

### Session 2, batch 3 — after the owner priced two products
- Owner published price + stock for **Búzios** (DIV-003, R$ 129,90, stock 100) and **Alaká**
  (VES-005, R$ 129,90, compare-at R$ 139,90, stock 100).
- **Cart happy path verified in Chrome** (:5173): add from the product page (badge "1 item" → "3 itens"),
  quantity changes (R$ 389,70 / economia R$ 20,00 → R$ 519,60 → R$ 389,70), stock limit through a
  temporary *emulator* inventory document (5 → 3 with notice; 0 → "Esgotado", checkout blocked; document
  deleted afterwards), /offers now lists Alaká. 13 more checklist items marked done (72 total).
- Session-1 dev server (PID 33028) stopped at the owner's request. A new one runs on :5173 under
  `emulators:exec`, started from Claude's session (it stops with that session). Owner can run
  **`npm run dev:emulated`** (dev server + Firestore/Auth emulators, no UI needed).
- **Pix module** (`app/.server/pix.ts`): Pix key recognition and validation (CPF/CNPJ check digits,
  incl. alphanumeric CNPJ; +55 phone; e-mail; random key), BR Code text normalisation, txid
  `PEDIDO<n>`, amount in whole centavos > 0, every generated code parsed back and compared, SVG QR.
  14 tests against independent CRC16/TLV implementations and the BCB manual example; mutation-checked.
  Not wired into orders/checkout yet.

### Session 2, batch 4 — checkout and orders (owner decisions 2026-11-01)
- Owner: flat rate for all of Brazil + pickup at Mercadão de Madureira; no free shipping; Melhor Envio
  later; CPF required at checkout (and at sign-up). The Pix key the owner gave (11 digits, in chat — kept
  out of the repo) is **not a valid CPF** but a valid Rio mobile number → presumably a phone key —
  **awaiting the owner's confirmation**; dev uses Banco Central's test key.
- Shared BR validators (`app/lib/br.ts`): CPF/CNPJ (incl. alphanumeric), phone → E.164, CEP, UFs.
- Store settings (`app/lib/store-settings.ts`, `app/.server/settings.ts`): Firestore `settings/payment`
  and `settings/shipping`, zod-validated, missing → config error shown at checkout.
  `scripts/dev/seed-emulator.mjs` seeds the emulator (refuses anything else); `npm run dev:emulated`
  now seeds then starts the dev server. Flat rate in dev = R$ 25,00 **placeholder**.
- **Orders** (`app/.server/orders.ts`): one transaction re-prices, reserves stock (seeding Firestore
  from Prismic on first sale), takes the next number (from 1001), builds the Pix code; idempotent per
  checkout key; nothing written on failure. 11 integration tests (incl. two simultaneous buyers for the
  last unit), mutation-checked.
- **`/checkout`** + **`/order-confirmation/:number?t=…`** verified on :5173: server field errors in
  Portuguese with focus, ViaCEP fill, order 1001 (delivery, R$ 414,70 = 389,70 + 25,00) and 1002
  (pickup), QR + copia e cola (`5406414.70`, `PEDIDO1001`), copy button, cart cleared, wrong/missing
  secret → 404, double submit → same order, changed cart → 409.
- Integration tests now run on their own emulator ports (`firebase.test.json`: 8280/9098) so they never
  touch a running dev emulator.
- Privacy fix: the owner's phone number had been used as an example (error message, tests, comments);
  replaced with a neutral number everywhere.

### Owner answers (2026-11-01, end of session 2)
- **Pix key confirmed**: a random key (EVP) registered at PagSeguro, taken from the owner's PagSeguro
  "copia e cola" (CRC verified). Stored only in `.env.local` (`STORE_PIX_KEY`, gitignored); production
  value goes into the admin settings. The 11-digit number given earlier was NOT the key.
- Payers' banks show the account holder's registered (personal) name, not "Loja Iyanifa" — owner may
  decide later whether the order page should mention it.
- Name on the QR: "Loja Iyanifa" (city "Rio de Janeiro"). Flat rate: **R$ 25,00** for now.
- CPF purpose text stays "Necessário para emitir a nota fiscal".
- Dev emulator re-seeded with these values; `/checkout` accepts them. Verified our module builds codes
  with this key (`0136<key>`, "LOJA IYANIFA", "RIO DE JANEIRO", amount, txid). Optional owner check:
  place a test order on the dev site and scan the QR in the bank app **without paying** — the app should
  show the PagSeguro account holder.

## Session 3 — 2026-11-01/02: admin sign-in with roles, orders, Pix confirm/cancel

### Owner decisions
- Baseline commit before any edit: `643da9e` (all of sessions 1–2). Session-3 work committed at the owner's
  request as `a3b31d2`, after `e418f1b` (`.gitattributes`).
- Admin 2FA: the server gate now; TOTP enrolment/sign-in screens are built on the real Firebase project
  (the Auth emulator only implements SMS second factors). Production admin sign-in is refused until then.
- Admin sessions last **12 hours**.
- Session-1 orphan emulator (functions+hosting) **stopped** with the owner's OK — ports 4000/4400/4500/5000/5001 are free.
- Production build check **skipped** (see "Found").

### Done and verified
- **Roles and sessions** — `app/lib/admin/roles.ts` (owner/admin/staff + capability table),
  `app/.server/session.ts` (session cookie, admission rule, sign-in/read/sign-out), `app/.server/audit.ts`,
  `app/.server/admin-guard.ts` (middleware gate + `requireCapability`), emulator guard in `app/.server/firebase.ts`.
  `scripts/admin/grant-role.mjs` (+ `roles.mjs`): emulator by default, `--production --project <id>` for real;
  revokes sessions on every change; 8 CLI cases verified. The dev seed now creates `dono@example.com` (owner),
  `equipe@example.com` (staff), `cliente@example.com` (no role) — password in `scripts/dev/seed-emulator.mjs`.
- **Admin UI** — `/admin/login` (browser SDK in memory only; forgot-password; verify-e-mail button),
  `POST /admin/logout`, `/admin` layout (gate, header, sign-out), `/admin/orders` (tabs + counts, 25/page,
  overdue Pix flagged), `/admin/orders/:number` (items, totals, customer incl. CPF, delivery, history,
  confirm payment, cancel with reason). The customer order page now says when an order was cancelled.
- **Orders** — `app/.server/admin-orders.ts`: list/counts, `confirmPixPayment` (reservation → sale),
  `cancelPendingOrder` (reservation released), one transaction each with history + audit entry.
  Composite index `orders (status ASC, number DESC)` added to `firestore.indexes.json` (unverifiable locally).
- **Tests** — unit 108 (22 new), integration 38 (16 new: 6 session, 10 admin orders incl. a confirm-vs-cancel
  race, re-run 6×), typecheck clean, lint 0 errors (new warnings are route-module exports only).
  Mutation-checked: 11 mutations caught.
- **Chrome on the dev server (:5173)** — signed-out redirect keeps `redirectTo`; wrong password; customer refused;
  owner and staff sign in (role shown); cookie not readable by JS; tabs/counts; overdue flag; sign-out revokes
  (emulator `validSince` moved) + audit entries; password reset (emulator OOB code); staff: no cancel form and a
  crafted cancel POST → 403; staff confirmed 1001 (stock 100/3 → 99/2 and 100/5 → 98/3, as computed); owner
  cancelled 1002 ("other" without a note → server error first); a stale tab confirming an order cancelled
  elsewhere → 409 notice and the page reloads to the real state; customer page of a cancelled order. The final
  emulator state matched the computed one.

### Found in session 3
- firebase-admin **always** checks revocation against the emulator (`checkRevoked || isEmulator` in
  base-auth.js), so emulator tests can't catch a missing `checkRevoked = true`; a stubbed unit test pins it.
- The Auth emulator (firebase-tools 15.24) implements SMS second factors only — no TOTP.
- React Router skips loader revalidation after an action answers 4xx (`actionStatus >= 400` in router.js);
  the order page opts back in on 409 (`shouldRevalidate`). Found in Chrome: the page claimed to show the
  current state but didn't.
- The Vite dev server listens on IPv6 `::1`: probe `http://localhost:5173`, not `127.0.0.1` (that returns nothing).
- `npm run build` fails with `EBUSY: rmdir build\functions`, also after the orphan emulator was stopped and with
  no emulator workers left. Holder not identified (suspected: WebStorm indexing `build\functions\node_modules`;
  Sysinternals `handle` isn't installed). Nothing in `build\` was deleted. Unresolved — owner chose to skip.
- `core.autocrlf=true` (Git for Windows system config): a `git checkout` of a file rewrites LF → CRLF, which would
  break `scripts/prismic/add-product.sh` under bash. Fixed at the owner's request: `.gitattributes`
  (`* text=auto eol=lf`, commit `e418f1b`); every tracked file was already LF, so nothing was renormalized.

### Not verified (session 3)
- Production build/bundles (EBUSY above): whether the Firebase browser SDK stays out of the server bundle and
  loads only with `/admin/login` (React Router's `.client` rule says so: `react-router:dot-client` in vite.js).
- TOTP flows (not built); real verification/password-reset e-mails (emulator only); the composite index in
  production; the admin layout on a phone (the automation viewport stays 1536 px).

## Handoff for the next session (read this first)
**State:** storefront, cart, checkout, orders and Pix codes (sessions 1–2) plus the admin: sign-in with roles,
orders list, order detail, confirm Pix / cancel unpaid orders — all verified except the production build.
Checklist: 105 done / 13 N/A (`ecommerce_master_build_prompt.md`). Tests: `npm test` (108 unit),
`npm run test:integration` (38, own emulator ports via `firebase.test.json`), `npm run typecheck`, `npm run lint`.
**Git:** `master` = `643da9e` baseline → `e418f1b` `.gitattributes` (LF everywhere) → `a3b31d2` admin
(this handoff fixed in the commit after it). Commit only when the owner asks; add files by path, never `git add .`.

**This machine:**
- Emulators need Java 21: prefix shell commands with `PATH="/c/Program Files/Microsoft/jdk-21.0.13.21-hotspot/bin:$PATH"`.
- Dev Firestore emulator :8180 (Docker owns 8080), Auth :9099; integration tests use :8280/:9098.
- The session-1 orphan emulator is gone: `npm run emulators` (with UI on :4000) should start again — not tried.
- A dev server + emulators started from Claude's session 2 may still run (`emulators:exec … react-router dev
  --port 5173`); probe `http://localhost:5173/healthz`. Its data is temporary: orders 1001 paid, 1002/1004/1005
  cancelled (test orders), **1003 is the owner's own test order — leave it alone**. Re-seed users/settings with
  `node scripts/dev/seed-emulator.mjs` (emulator only). A fresh start: `npm run dev:emulated`.
- `npm run build` currently fails with EBUSY on `build\functions` (see Found). Exclude `build/` from WebStorm
  indexing or close WebStorm, then retry.
- Never put the owner's personal data (phone, Pix key, names, e-mail) in committed files — `.env.local` /
  Firestore only; grep before finishing (session 3: 0 hits).

**Owner actions before production admin works:** create the Firebase project (Blaze) and upgrade Auth to Identity
Platform with TOTP MFA enabled; set `FIREBASE_WEB_API_KEY` / `FIREBASE_AUTH_DOMAIN` for the function; create the
owner account (console → Authentication → Add user), run
`node scripts/admin/grant-role.mjs --production --project <id> --email <owner e-mail> --role owner`, then verify the
e-mail from the sign-in page. Then build the TOTP screens (next item) and test them there.

**Not built yet (in order):** TOTP enrolment + sign-in screens (needs the real project) → Pix expiry job (cancel
unpaid after `expiryHours` through the same transaction as `cancelPendingOrder`, with `by: "system"`) →
fulfilment statuses (processing/shipped/delivered) + internal notes → refunds (record full/partial; cancelling
paid orders) → transactional e-mails (SMTP provider needed) → activity-log viewer → `/admin/users` → admin
dashboard → customer accounts (CPF required at sign-up) → coupons → Melhor Envio. Terms/privacy pages are Prismic
content the owner must publish (checkout links to them).
