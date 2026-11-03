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
- Production build: skipped at first (EBUSY), then fixed and verified after the push (see "Found").

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
- **Production build** (`npm run build`, after the push) passes. The server bundle has no Firebase browser SDK:
  `firebase` isn't among the 13 packages it imports, and 0 hits for `signInWithEmailAndPassword`,
  `inMemoryPersistence`, `connectAuthEmulator`, `getIdToken`. In the browser the SDK is one chunk
  (`admin.login-*.js`, 27.6 KB gzipped) that only the `/admin/login` route loads.

### Found in session 3
- firebase-admin **always** checks revocation against the emulator (`checkRevoked || isEmulator` in
  base-auth.js), so emulator tests can't catch a missing `checkRevoked = true`; a stubbed unit test pins it.
- The Auth emulator (firebase-tools 15.24) implements SMS second factors only — no TOTP.
- React Router skips loader revalidation after an action answers 4xx (`actionStatus >= 400` in router.js);
  the order page opts back in on 409 (`shouldRevalidate`). Found in Chrome: the page claimed to show the
  current state but didn't.
- The Vite dev server listens on IPv6 `::1`: probe `http://localhost:5173`, not `127.0.0.1` (that returns nothing).
- `npm run build` failed with `EBUSY: rmdir build\functions` — `react-router build` deletes `build\` first, and
  Windows refuses to delete a folder that a process uses as its working directory. First holder: the session-1
  orphan emulator (its functions worker ran in `build\functions`). After it was stopped the error repeated —
  most likely Claude's own shell, left in `build\functions` by a timestamp check just before (unproven:
  Sysinternals `handle` isn't installed). With both gone the build passes; nothing in `build\` was ever deleted.
  **Never leave a shell (or an Explorer window) inside `build\`.**
- `core.autocrlf=true` (Git for Windows system config): a `git checkout` of a file rewrites LF → CRLF, which would
  break `scripts/prismic/add-product.sh` under bash. Fixed at the owner's request: `.gitattributes`
  (`* text=auto eol=lf`, commit `e418f1b`); every tracked file was already LF, so nothing was renormalized.

### Not verified (session 3)
- TOTP flows (not built); real verification/password-reset e-mails (emulator only); the composite index in
  production; the admin layout on a phone (the automation viewport stays 1536 px).

## Session 4 — 2026-11-02 (evening): TOTP, Pix expiry, fulfilment + notes, refunds

### Owner decisions
- The real Firebase project **`lojaiyanifa`** exists with Identity Platform + TOTP enabled (owner, 2026-11-02). The
  gitignored `.env` already holds its public web config (`FIREBASE_WEB_API_KEY`, `FIREBASE_AUTH_DOMAIN`).
- TOTP is verified on a **first deploy to `lojaiyanifa` with checkout closed** (no `settings/payment` there, so checkout
  answers "pagamento não configurado"). **Nothing is deployed without the owner's explicit go.**
- A **partial refund has its own status** (`partially_refunded`, as designed); shipping goes on in `fulfillment.stage`.
- **Refund stock per item**: by default every unit while the order is still in the store, none after it left.
- Diagnose-before-fix for the transaction-race failure, then the re-read fix (both approved in chat).

### Done and verified
- **#1 TOTP screens** (`app/.client/firebase.ts`, `app/routes/admin.login.tsx`, `app/lib/admin/totp.ts`): code step after
  the password; enrolment (QR drawn in the browser, manual key, `otpauth://` link for the phone with the app); SMS-only
  accounts refused; errors mapped from the SDK's real codes. **Verified in Chrome** on a second dev server
  (:5174, `ADMIN_REQUIRE_MFA=true`): owner without a factor → enrolment screen; "Configurar agora" against the emulator
  → `auth/invalid-argument` shown as "Não foi possível configurar…"; Cancelar → clean password screen; an emulator
  account with an SMS factor → "Esta conta usa outro tipo de verificação…"; wrong password / customer messages
  unchanged; on :5173 (MFA off) sign-out → sign-in → `/admin/orders`. Two flaws found in Chrome and fixed (stale
  messages after a new attempt/Cancelar; fallback verb). **Not verifiable locally:** the TOTP exchange itself.
  `scripts/admin/reset-mfa.mjs` (lost phone: removes factors, revokes sessions, audits `mfa.reset`): 8 CLI cases on the
  emulator.
- **#2 Pix expiry job** (`expireOverdueOrders` in `app/.server/admin-orders.ts`; scheduled `expirePixOrders` in
  `server/app.ts`, every 15 min, America/Sao_Paulo, max 1 instance, no retries): 6 integration tests (only overdue pending
  orders, deadline boundary, idempotent, race with a confirmation, one corrupt order doesn't stop the rest, batches);
  the built module exports it with the right schedule metadata. New index `orders (status ASC, expiresAt ASC)`.
- **#3 Fulfilment + internal notes** (`app/.server/order-fulfillment.ts`, `app/lib/admin/fulfillment.ts`, order page,
  list tabs, customer page): 11 unit + 10 integration tests; in Chrome on order 1001 (written before today → the legacy
  read path) and new order 1006 (pickup): note added; preparing; ship form refused a code without carrier and an
  `http:` link (server-side), then shipped with tracking; pickup "Pronto para retirada"; customer page progress +
  pickup address.
- **#4 Refunds** (`app/.server/order-refunds.ts`, `app/lib/admin/refunds.ts`, `parseDecimalToCents` in `app/lib/money.ts`):
  8 unit + 9 integration tests; in Chrome: partial refund on 1001 (R$ 10,00, 1 × VES-005 back) → "Reembolsado
  parcialmente", then shipped (status kept, stage "Enviado" shown in the list); 1006 partial refund → customer page
  "Reembolso parcial — R$ 5,00 devolvidos em…" without the internal reason. Found in Chrome and fixed: a pickup order
  "ready for pickup" defaulted to 0 units back (it is still in the store) → `restockByDefault(stage, method)`.
- **Race robustness**: `settlePendingOrder`, `takeFulfillmentStep` and `recordRefund` re-read the order after a failed
  transaction and report the domain error (409) when the order changed meanwhile — tested with a stubbed "transaction
  closed" error; mutation-checked.
- **Totals**: unit 132 (24 new), integration 65 (27 new), tsc 0, lint 0 errors / 63 warnings (same as before),
  `npm run build` passes (13 packages, still no browser Firebase SDK in the server bundle). Mutations caught: 10/10
  (M1–M10). Checklist 105 → 121 done.

### Found in session 4
- **Firestore emulator + concurrent transactions**: the losing transaction is sometimes closed with
  `3 INVALID_ARGUMENT: Transaction is invalid or closed` after ~8–12 s instead of being retried (≈1 race run in 6,
  fresh emulators too). Oops on the way: I first blamed my long-running test emulator; a fresh-emulator failure refuted
  that. Fixed in code (re-read, above). Whether production Firestore can return this is unverified.
- Run integration tests on **fresh** emulators (`npm run test:integration`, or
  `firebase --config firebase.test.json emulators:exec --only firestore,auth --project demo-lojaiyanifa "npx vitest run --config vitest.integration.config.ts <file>"`).
  The command string runs in a shell: no `|` inside it (`-t race|wins` became a pipe). Vitest here hides console
  output of passing tests — use `--reporter=verbose` for per-test durations instead of logging.
- `TaskStop` on a background shell leaves its children running (emulator java, react-router dev): find them by command
  line and stop those PIDs only.
- Vite optimizes `qrcode` for the browser the first time a server loads the login page and **reloads that page**:
  a click right then is lost. Cookies are shared across `localhost` ports, so a session from :5173 shows on :5174.
- The Chrome extension disconnected once mid-test; reconnected later without changes on our side.
- `reset-mfa.mjs` printed one Node warning once (cut off by `tail`); not reproduced.

### Not verified (session 4)
- The TOTP code exchange (real project only); the Cloud Scheduler trigger and the new composite index in production;
  staff's view of refunds in Chrome (capability unit-tested; the page hides the form, the action checks
  `orders.refund`); the automatic-cancellation text on the admin order page (data path integration-tested; not opened
  in Chrome: running the job on the dev data would also cancel the owner's order 1003).

## Session 5 — 2026-11-03: deploy readiness, production config

### Owner decisions
- **Single admin account:** the owner only. The e-mail is kept out of the repo.
- `/admin/users` dropped (checklist N/A).
- Apply the production-config fix.
- Restore `.firebaserc`'s demo default and add a `prod` alias.
- Commit before deploying.

### Found (deploy readiness check)
- **Blocker, now fixed: production config never reached the deployed function.**
  - `env.ts` requires `SITE_URL` and `PRISMIC_REPO`.
  - The Firebase CLI loads only `.env` / `.env.<project-id>` from the functions source folder (`build/functions`).
  - The build copied only `.env.local`, which the CLI loads for the emulator only.
  - Deployed as-is, every page would have returned 500.
- **`FIREBASE_*` names can't be deployed.** firebase-tools 15.24.0 refuses the prefixes `FIREBASE_`, `X_GOOGLE_` and
  `EXT_` (`lib/functions/env.js`). The web config was renamed `WEB_API_KEY` / `WEB_AUTH_DOMAIN`.
- **No Prismic token needed.** The Content API answers without a token (HTTP 200), so production needs no token or secret.
- **`npm run preview` (not fixed; not verified by running preview).**
  - The CLI also refuses `build/functions/.env.local` in emulator mode, because the dev `.env.local` holds
    `FIREBASE_PROJECT_ID` and `FIREBASE_AUTH_EMULATOR_HOST`.
  - So the functions emulator probably can't load its config.
  - The problem predates session 5.
- **The owner's root `.env` (gitignored) is read by nothing.** Its web config was copied into `.env.lojaiyanifa`.
- **Service-account key in the repo root.**
  - The owner downloaded it; it is gitignored (`*-firebase-adminsdk-*.json`).
  - `grant-role.mjs --production` takes `GOOGLE_APPLICATION_CREDENTIALS` from the shell, not from `.env`.
  - Recommended: move the key out of the project folder, and delete it in the console once the owner role is granted.
- **`parseEnv` (`node:util`) returns keys sorted, not in file order.** One test assumed file order; fixed in the test.
- **Claude Code's memory-pressure reaper** dropped its handle on the session-2 dev server (~10:00). The dev server
  processes kept running, and its data survived.

### Done and verified
- **Commit `867bed1`:** the session-4 work (36 files).
- **`.firebaserc`:** `default` = `demo-lojaiyanifa`, `prod` = `lojaiyanifa`. The CLI keeps no per-folder active project
  for this repo (checked in its configstore), so `.firebaserc` decides.
- **Production config:**
  - `scripts/functions-env.mjs` is the functions `predeploy` hook in `firebase.json`. It checks the root
    `.env.<project-id>` and copies it into `build/functions/`. Types are in `functions-env.d.mts`.
  - `.env.lojaiyanifa` (gitignored, checked with `git check-ignore`) was written from the owner's `.env` without
    printing the key. It holds `SITE_URL=https://lojaiyanifa.web.app`, `PRISMIC_REPO`, `PRISMIC_LOCALE`,
    `WEB_API_KEY`, `WEB_AUTH_DOMAIN` and `ADMIN_REQUIRE_MFA=true`.
  - 6 unit tests; 3 of 3 mutations caught.
  - The hook was run the way the CLI runs it (through `cmd`, with `GCLOUD_PROJECT` / `PROJECT_DIR` / `RESOURCE_DIR`
    set). It copies the file for `lojaiyanifa`, and exits 1 for a missing file or a missing project.
  - firebase-tools' own `loadUserEnvs` (deploy mode, `lojaiyanifa` via `prod`) loads exactly those 6 keys.
  - The server's own schema (`env.ts`, run with `--experimental-strip-types`) accepts the file, with MFA on and no
    emulator.
- **Totals:**
  - unit tests 138, integration tests 65 (fresh emulators);
  - tsc 0 errors; lint 0 errors, 63 warnings;
  - build passes (13 packages);
  - checklist 121 done / 14 N/A.

### Not verified (session 5)
- Anything on the real project: no deploy, no `grant-role`. Nothing touched `lojaiyanifa`.
- The hook inside a real `firebase deploy`. It was run by hand exactly as the CLI's source shows it is called.

## Handoff for the next session (read this first)
**State:**
- Sessions 1–2: storefront, cart, checkout, orders and Pix codes.
- Session 3: admin sign-in with roles.
- Session 4: TOTP screens (verification pending on the real project), Pix expiry job, fulfilment (preparing →
  shipped / ready → delivered / picked up) with tracking, internal notes, full/partial refunds with stock returns.
- Session 5: production config for the deployed functions; `.firebaserc` `prod` alias; `/admin/users` dropped.
- Everything is verified as listed above.

**Not deployed yet.** That waits for the owner's console steps and explicit go (below).

**Checks:**
- Checklist: 121 done / 14 N/A (`ecommerce_master_build_prompt.md`).
- `npm test` (138 unit) and `npm run test:integration` (65, own emulator ports via `firebase.test.json`).
- `npm run typecheck` and `npm run lint`.

**Git:**
- `master`: `643da9e` baseline → `e418f1b` `.gitattributes` (LF everywhere) → `a3b31d2` admin → `246acfa` handoff
  fixes → `867bed1` session 4 → the session-5 config commit right after it.
- Pushed to `origin/master` up to `246acfa` by the owner; the session-4 and session-5 commits are local.
- Commit only when the owner asks. Add files by path, never `git add .`.

**This machine:**
- Emulators need Java 21: prefix shell commands with `PATH="/c/Program Files/Microsoft/jdk-21.0.13.21-hotspot/bin:$PATH"`.
- Dev Firestore emulator :8180 (Docker owns 8080), Auth :9099; integration tests use :8280/:9098.
- The session-1 orphan emulator is gone: `npm run emulators` (with UI on :4000) should start again — not tried.
- A dev server + emulators started from Claude's session 2 still ran on 2026-11-03. Its PIDs were
  33300 (firebase), 12220 (java) and 44052/13692/3280 (react-router dev).
  - Command: `emulators:exec … react-router dev --port 5173`, started 2026-11-01 13:52.
  - Claude Code no longer tracks it (memory-pressure reaper, session 5), so stopping it means those PIDs.
  - Probe it with `http://localhost:5173/healthz`.
  Its data is temporary test data: 1001 partially refunded (R$ 10,00) + shipped with test tracking + a test note;
  1002/1004/1005 cancelled; **1003 is the owner's own test order (still pending, past its deadline) — leave it alone,
  and never run the expiry job against this dev data**; 1006 (session 4, pickup) paid, ready for pickup, R$ 5,00
  refunded. Two `mfa.reset` audit entries come from session-4 script tests; the temporary `sms@example.com` user was
  deleted. Re-seed users/settings with `node scripts/dev/seed-emulator.mjs` (emulator only). A fresh start:
  `npm run dev:emulated`. Session 4's second dev server (:5174) and test emulators were stopped.
- `npm run build` works. It deletes `build\` first: if it fails with EBUSY, some process (a shell, Explorer, an
  emulator serving `build\functions`) is sitting in that folder — Resource Monitor → CPU → Associated Handles →
  search `build\functions` names it.
- Never put the owner's personal data (phone, Pix key, names, e-mail) in committed files — `.env.local` /
  Firestore only; grep before finishing (session 3: 0 hits).

**Production config (session 5):**
- Deployed functions read the gitignored root file `.env.lojaiyanifa`. It exists on this machine and was created
  2026-11-03.
- The functions predeploy hook (`scripts/functions-env.mjs`) checks it and copies it into `build/functions/` on every
  functions deploy. A missing or unsafe file stops the deploy.
- What it must contain: `.env.example`, "Production", and `docs/architecture.md` §8.
- The owner's root `.env` is now redundant: nothing reads it.
- Single admin account: the owner. The e-mail is not written here (owner data).

**Owner actions before the first deploy (TOTP check):**
1. Google credentials for the admin scripts: the downloaded service-account key, passed through the shell's
   `GOOGLE_APPLICATION_CREDENTIALS`, or `gcloud auth application-default login`.
2. Blaze plan, then a Firestore database in `southamerica-east1`.
   - The location can't be changed later.
   - Create it **before** running `grant-role`, which writes to `auditLogs` after setting the claim.
3. Turn on Email/Password sign-in, then create the owner account (console → Authentication → Add user).
4. Grant the role, with `GOOGLE_APPLICATION_CREDENTIALS` set in the same shell:
   `node scripts/admin/grant-role.mjs --production --project lojaiyanifa --email <owner e-mail> --role owner`.
   This script takes the real project ID, not the `prod` alias.

**Deploy, on the owner's go:**
1. `npm run build`.
2. `firebase deploy --only firestore --project prod`, then wait until both indexes are "Enabled". The expiry job's query
   needs one of them.
3. `firebase deploy --only hosting,functions --project prod`.
   - The predeploy hook prints `.env.lojaiyanifa checked and copied`.
   - Don't run a bare deploy: `firebase.json` also lists Storage, which the app doesn't use.
4. Leave `settings/payment` absent so checkout stays closed.
5. On `https://lojaiyanifa.web.app/admin/login`: verify the e-mail, enrol TOTP (back it up on a second device), sign in
   with a code, sign out.
6. Check the order tabs (indexes) and `curl -I` an `/assets/*` file (immutable cache header).
7. Stop and report if:
   - pages answer 500 (`firebase functions:log --only ssr --project prod`);
   - TOTP fails (never set `ADMIN_REQUIRE_MFA=false` to get in);
   - the deploy warns "Unable to set the invoker" (a Google Workspace organization policy makes every page answer 403).

**Not built yet (in order):**
1. First deploy + TOTP verification (above).
2. Transactional e-mails. Needs an SMTP provider and a verified sender domain; the shipped / refunded / cancelled
   events are ready to hook in.
3. Activity-log viewer (`auditLogs`).
4. Admin dashboard.
5. Customer accounts (CPF required at sign-up).
6. Coupons.
7. Melhor Envio.

`/admin/users` was dropped on 2026-11-03: single admin account.

**Needed before launch but not on this list:**
- `/admin/settings`: today the production Pix key could only be entered in the Firebase console.
- `/admin/inventory`: stock adjustments.
- Terms/privacy pages: Prismic content the owner must publish (checkout links to them).

**Known issue:** `npm run preview` probably can't load `build/functions/.env.local`, because of the `FIREBASE_*` names
(session 5, "Found").
