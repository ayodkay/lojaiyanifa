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

### Not verified (session 5, morning)
- Anything on the real project: the morning work touched nothing on `lojaiyanifa`. The deploy came in the afternoon
  (below).
- The hook inside a real `firebase deploy`: verified in the afternoon (it printed its check line on both deploys).

## Session 5, afternoon — 2026-11-03: first deploy, owner role, TOTP on, preview fixed

### Owner decisions
- Grant the owner role, deploy, and fix `npm run preview`. The owner pushes.
- TOTP turned out to be off on the project (below): turn it on with the Admin SDK (TOTP, 5 adjacent intervals, SMS
  stays off).
- The first functions deploy runs with `--force`, so the CLI applies its default cleanup policy (container images
  deleted after 1 day) instead of failing on a prompt it can't show.
- After the 409 (below): retry `ssr` + hosting only.

### Done and verified
- **Read-only preflight** (Firebase CLI, and the Admin SDK with the service-account key):
  - Hosting site `lojaiyanifa` → `https://lojaiyanifa.web.app`, which matches `SITE_URL`.
  - Firestore `(default)`: Native mode, `southamerica-east1`.
  - Owner account: password provider, e-mail not yet verified, no role, no second factor.
  - `settings/payment` absent (checkout closed); no orders; no audit entries.
  - Auth: Identity Platform, e-mail sign-in on, authorized domains include both site domains. **MFA was DISABLED**
    (TOTP off), although an earlier answer said it was on.
  - No functions existed: the Cloud Functions API had never been enabled (403 on list).
- **Owner role:** `grant-role --production` printed role (none) → owner and revoked all sessions. Re-read: the claim
  is set and there is 1 audit entry.
- **Build:** `npm run build` from the clean tree at `2438821`.
- **Firestore:** `firebase deploy --only firestore --project prod` released the rules. Both indexes were READY after
  about 4 minutes.
- **Functions and hosting:**
  - `firebase deploy --only hosting,functions --project prod --force`: the hook ran, the APIs were enabled and
    `expirePixOrders` was created. `ssr` failed (409, below) and hosting was not released.
  - The retry `firebase deploy --only functions:ssr,hosting --project prod --force` created `ssr`, configured the
    cleanup policy (1 day) and released hosting. Exit 0, no invoker warning.
- **Live checks** (curl):
  - `/`, `/products/alaka`, `/collections/all`, `/cart` and `/search?q=pano` answer 200 with their titles.
    `/sitemap.xml` answers 200.
  - `/admin` → 302 to `/admin/login` (`private, no-store`, `noindex`); `/admin/login` answers 200.
  - The CSP's `connect-src` allows identitytoolkit, securetoken and googleapis.
  - `/assets/*` → `public, max-age=31536000, immutable`.
  - Function logs show no configuration error.
- **TOTP turned on:** Admin SDK `updateProjectConfig`, sending only `mfa.providerConfigs`. A re-read through the
  Identity Toolkit admin API shows TOTP ENABLED (5 intervals) and SMS still DISABLED.

### Found
- **First-deploy race on 2nd-gen functions:**
  - Creating `ssr` and `expirePixOrders` at once on a fresh project failed `ssr` with `HTTP Error: 409, Could not
    create bucket gcf-v2-sources-<project-number>-southamerica-east1`.
  - The other function's create made that bucket at the same moment (14:51:47Z).
  - Retrying `ssr` alone worked. Only the first deploy in a region can hit this.
- **The Firebase CLI is non-interactive from Claude's tools** (stdin isn't a TTY, `lib/command.js`).
  - A prompt it can't show becomes an error.
  - The cleanup-policy prompt would have thrown after the functions were created, before hosting was released.
  - `--force` answers it with the default. It's no longer needed for that, because the policy now exists.
- **Piped output lost the CLI's last lines** on the first deploy: no error summary and no `firebase-debug.log`.
  - The cause is unknown: an asynchronous pipe at exit, or the process was killed.
  - Redirecting to a file (`> log 2>&1`) gave the full output and firebase's real exit code.
- **`/robots.txt` answers an empty 404 in production.**
  - The function's own URL does too, while `/sitemap.xml` works.
  - Cause (a theory that afternoon, verified from source in the evening): the Cloud Functions Framework answers
    `/robots.txt` and `/favicon.ico` itself, before the app.
  - Effect: crawlers don't get the Disallow rules (`/admin`, `/account`, `/cart`…) or the Sitemap line. Admin pages
    still send `noindex` and need a session.
  - Fixed and deployed in the evening (below).
- **`/healthz` never reaches the function in production.**
  - Google's front end answers with its own "Error 404 (Not Found)!!1" page; Cloud Run reserves paths ending in `z`.
  - It works in dev and in the emulator. Renamed `/health` and deployed in the evening (below).
- **`npm run preview` was broken (verified).** With the deployed build, the functions emulator printed `Failed to load
  function definition from source: FirebaseError: Failed to load environment variables from .env.local.`, and every
  page answered 404 "Function southamerica-east1-ssr does not exist".
- **A stray `firebase init` process** (PID 47288, started 00:15 on 2026-11-03) was running on this machine. Claude
  didn't start it and left it alone. It was gone by the late evening.

### Preview fix: done and verified
- **The fix:** `emulatorEnvFile` (`scripts/functions-env.mjs`) drops the lines whose names have a prefix the CLI
  refuses and keeps every other line byte for byte. `scripts/build-functions.mjs` writes `build/functions/.env.local`
  with it and names what it left out.
- **Tests:** 2 unit tests (failing first), and 3 of 3 mutations caught.
- **Emulator check:** preview's emulator set ran on spare ports (`emulators:exec --only functions,hosting,firestore,auth`
  with a temporary config, removed afterwards).
  - Both functions load. `expirePixOrders` is ignored (no Pub/Sub emulator), so it can't run.
  - `/healthz` (renamed `/health` in the evening) 200, `/` 200, `/admin` 302 → login, `/admin/login` 200.
  - The dev emulators (order 1003) weren't touched: the emulator's own hosts override `.env.local`'s.
- **Totals:**
  - unit tests 140 (17 files);
  - tsc 0 errors; lint 0 errors, 63 warnings;
  - build OK.
  - Integration tests were not re-run, because no app code changed.

### Not verified (afternoon)
- The TOTP exchange (enrolment, then sign-in with a code) and the admin orders tabs: they need the owner's first
  sign-in.
- The e-mail verification link (Firebase's default template, sent from `noreply@lojaiyanifa.firebaseapp.com`).
- A scheduled run of `expirePixOrders`. None was seen in the log yet; it started cleanly at 14:53Z.
- `npm run preview` on its own standard ports, which the dev emulators hold. The same emulators, build and config were
  checked on spare ports.

## Session 5, evening — 2026-11-03: robots.txt and favicon.ico through Hosting, `/health`

### Owner decisions
- `/robots.txt`: a static file written at deploy time from `SITE_URL` (the fix proposed in the afternoon).
- Rename `/healthz`. It is now `/health`.
- `/favicon.ico`: a Hosting redirect to `/favicon.svg`, written as a `regex` (Found, below). Then commit, and deploy
  `ssr` + hosting.

### Found
- **The robots.txt cause, verified from source:** for HTTP functions, the Node Functions Framework
  (`functions-framework-nodejs`, `src/server.ts`) answers `/favicon.ico` and `/robots.txt` with a 404 and an empty
  body before the app's handler. Production shows exactly that for both paths.
- **`/favicon.ico` has the same problem in production** (curl: empty 404 on the site and on the function's own URL).
  The app's 301 to `/favicon.svg` never runs. Every page links `/favicon.svg` as its icon, so only clients that ask
  for `/favicon.ico` anyway are affected. Fixed with a Hosting redirect (below).
- **This machine's Hosting emulator can't apply `source` redirects.** Superstatic 10.0.0 (inside firebase-tools)
  passes each `source` through `glob-slasher`, which on Windows turns `/favicon.ico` into `\favicon.ico`. That never
  matches, so the request fell through to the rewrite, and the functions emulator answered with its copy of Google's
  rule (`functionsEmulatorRuntime.js`). Shown in memory with superstatic's own code. The `regex` form isn't affected.

### Done and verified
- **robots.txt:**
  - `scripts/robots-txt.mjs` is the hosting `predeploy` hook in `firebase.json`. It reads `.env.<project-id>`, runs
    the functions hook's checks (`productionEnvProblems`) and writes `build/client/robots.txt`. Hosting serves files
    from `build/client` before its rewrite to `ssr`.
  - The rules moved from the route unchanged. `SITE_URL` loses trailing slashes, as in `app/.server/env.ts`.
  - It stops the deploy when `GCLOUD_PROJECT` isn't set, the env file is missing or fails the checks, or
    `build/client` isn't built.
  - The route `app/routes/robots-txt.ts` is deleted: it could never answer in production. In dev, `/robots.txt` is
    now a 404.
- **`/health`:** `app/routes/health.ts`, the same loader as `/healthz`, with a comment on why the name doesn't end in
  `z`.
- **`/favicon.ico`:** `firebase.json` redirects it to `/favicon.svg` (301, `"regex": "^/favicon[.]ico$"`). Hosting
  applies redirects before files and rewrites. The route `app/routes/favicon-ico.ts` is deleted, and `docs/brand.md`
  now says to remove the redirect if a real `favicon.ico` is ever added.
- **Tests:** 3 unit tests (`tests/unit/robots-txt.test.ts`, one at a time), and 4 of 4 mutations caught.
- **By hand:** `GCLOUD_PROJECT=lojaiyanifa node scripts/robots-txt.mjs` wrote the production rules, ending with
  `Sitemap: https://lojaiyanifa.web.app/sitemap.xml`. Without the env file, or without `GCLOUD_PROJECT`, it exits 1.
- **Emulator check** (spare ports, temporary config removed afterwards): `/robots.txt` 200 `text/plain`, identical to
  the file (no route is left, so Hosting served it); `/favicon.ico` 301 → `/favicon.svg` (the `source` form got the
  empty 404, Found above); `/favicon.svg` 200; `/health` 200 JSON; `/healthz` 404; `/` 200.
- **Dev server** (:5173) picked up the change: `/health` 200, `/healthz` 404.
- **Totals:** unit tests 143 (18 files); tsc 0 errors; lint 0 errors, 63 warnings; build OK.

### Deployed and verified (evening)
- **Commit** `7f99658`, then `npm run build` from the clean tree.
- **Deploy:** `firebase deploy --only functions:ssr,hosting --project prod` (no `--force`), exit 0. Both hooks ran,
  and the hosting hook wrote the production robots.txt. `ssr` was updated and hosting released, with no prompt and no
  invoker warning.
- **Live** (`https://lojaiyanifa.web.app`):
  - `/robots.txt` 200 `text/plain`, identical to the deployed file.
  - `/favicon.ico` 301 → `/favicon.svg`.
  - `/health` 200 JSON (`no-store`).
  - `/`, `/products/alaka` and `/sitemap.xml` 200; `/admin` 302 → login; an `/assets/*` file `immutable`.
  - `/healthz` still gets Google's own 404 (expected).
- **Function log after the deploy** (Logs Explorer, checked by the owner; Cloud Run entries for `ssr` since 21:30Z):
  - The deploy replaced the service at 21:54Z. Revision `ssr-00002-lac` started (`DEPLOYMENT_ROLLOUT`) and was ready
    at 21:55Z ("Deploying revision succeeded in 15.85s").
  - The live checks at 21:56Z: `/`, `/health`, `/products/alaka` and `/sitemap.xml` 200, `/admin` 302. No errors.
  - `/robots.txt`, `/favicon.ico`, `/favicon.svg` and the asset never reached the function (Hosting answered them),
    and neither did `/healthz` (Google's front end).
- **Scanners in the log:** probes at 20:58Z (`/.env` variants, `/phpinfo`, `/info.php`) and 21:36–21:37Z
  (`/wp-login.php`, `/xmlrpc.php`, `/wp-admin/`, `/wp-json/`) all got the store's 404. React Router writes each
  unmatched URL to the log with a stack trace (severity unset): noise to filter out of any future log alert.
- **`firebase functions:log` gave a stale view:** at 21:58Z and again at 22:46Z it showed nothing newer than
  21:36:53Z, while the Logs Explorer has entries from 21:37Z on, from the same revision. It returned an older slice
  of the log instead of the newest entries; why is unverified. Use the Logs Explorer (handoff, "Redeploying").

### Progress check (late evening)
- Checklist: 121 done, **371 open**, 14 N/A (506 items). `scripts/checklist-update.mjs` prints "N with notes": that
  is the open items that have a note (99), not all open items.
- Six open notes contradicted this record and were corrected, statuses unchanged: "Footer with important links",
  "Buy now button", "Proceed to checkout button", "Payment processing", "Payment confirmation", "Automated testing".
- The old dev server stack (33300, 12220, 44052, 13692, 3280) still runs; the stray `firebase init` (47288) is gone.

## Session 5, night — 2026-11-03: `/admin/settings`

### Owner decisions
- Build `/admin/settings` next.
- Checkout gets its own open/close switch: saving the Pix or delivery settings never opens it.

### Done and verified
- **The switch:** `settings/store.checkoutOpen`, absent = closed (`getStoreSettings`).
  - `loadOrderDeps` checks it before reading anything else and throws `CheckoutClosedError`.
  - `/checkout` shows the existing "temporariamente indisponível" notice without logging an error; its action
    answers 503.
  - The dev seed opens checkout.
- **Who:** `settings.view` (owner, admin) and `settings.edit` (owner), as in `docs/architecture.md` §3. Staff get
  no link and a 403.
- **Server** (`app/.server/admin-settings.ts`, `app/.server/settings-forms.ts`):
  - The forms are parsed with Portuguese field errors. The Pix key is checked by `parsePixKey` and stored as the DICT
    holds it. A name or city longer than the code allows is refused.
  - Each save is one transaction: refused when the page is stale (409), nothing written when nothing changed, and an
    audit entry listing the changed fields, with the Pix key masked.
  - Opening re-checks the blockers inside the same transaction. Turning off both delivery methods is refused while
    checkout is open.
- **Page** (`/admin/settings`, "Configurações" in the nav for owner and admin):
  - Checkout status, with open and close; opening needs a confirmation box.
  - The Pix form, showing how the name and city print on the code.
  - A R$ 1,00 test code (QR + copia e cola) to read in the bank app without paying.
  - The delivery form. An admin sees everything read-only.
- **Tests:** 9 unit + 6 integration, run one at a time; 8 of 8 mutations caught.
- **Totals:** unit 152 (19 files), integration 71 (9 files), tsc 0 errors, lint 0 errors / 67 warnings (the 4 new
  ones are route-module exports), build OK with no server code in the browser bundle.
- **Browser**, on a separate dev server (:5176) with fresh emulators on spare ports and the Banco Central test key.
  The old dev stack wasn't touched, and the separate stack was stopped afterwards.
  - Empty page: checkout closed, both blockers listed.
  - An invalid key gets its message under the field, and nothing is saved.
  - Payment saved: key type, printed name and city, and the test code (the QR loads; the code carries the key, TESTE
    and R$ 1,00).
  - Delivery saved: opening is offered. Opened: the customer's `/checkout` is open. Closed: the customer sees the
    notice.
  - A save from a stale page gets the 409 notice, and the stored value is shown.
  - Staff: no link, 403, and a crafted POST gets 403.
  - Admin (role set with `grant-role` on the spare emulator only): read-only, all 14 fields disabled, no buttons, and
    a crafted POST gets 403.

### Found
- The old dev server (:5173) hot-reloaded the change. Its emulator has no `settings/store`, so its checkout now shows
  as closed (handoff, "This machine").

### Deployed (night)
- Commit `2b7e6ec`, then `npm run build` from the clean tree, then
  `firebase deploy --only functions:ssr,hosting --project prod` (no `--force`). Exit 0; both hooks ran, `ssr` was
  updated and hosting released, with no prompt and no invoker warning.
- Live checks:
  - `/admin/settings` 302 → login (`private, no-store`).
  - `/checkout` 200 with the closed notice (production has no `settings/store`).
  - `/health`, `/` and a product page 200; `/admin` 302.
  - `/robots.txt` identical to the deployed file; `/favicon.ico` 301; an asset `immutable`.

### Not verified (night)
- The page in production: it needs the owner's first sign-in (TOTP). Then: save Pix and delivery, read the test code
  without paying, and open checkout when ready.
- The function log after this deploy: the Logs Explorer query in the handoff ("Redeploying"); `firebase functions:log`
  is unreliable.

## Session 5, after midnight — 2026-11-04: a missing `/assets/` file gets a 404 nothing keeps

### Found
- The owner saw `/admin/login` unstyled, with both buttons grey, in one Chrome tab (screenshot pasted at 00:19, about
  1½ h after the night's deploy). That tab's CSS and JavaScript hadn't loaded: the buttons stay disabled until the
  JavaScript starts.
- Not reproduced. From this machine, the live page and all 21 files it uses answered 200 on `web.app` and
  `firebaseapp.com`. A fresh load in the owner's Chrome was styled, both buttons enabled, no console errors. The old
  dev server (:5173) served its page and files too, and no Hosting preview channel exists. What happened in that tab
  is not known.
- How a page loses its files: a deploy puts the new `ssr` live a few seconds before Hosting releases the new files. A
  page loaded in that gap asks for names Hosting doesn't have yet. They fall through the `**` rewrite to the function,
  which answered with the store's 404 page and no `Cache-Control`. Firebase sends such a response on as `max-age=600`
  and its CDN keeps it (`x-cache: HIT` on a second request for a made-up name), so browsers and the CDN kept the 404
  for 10 minutes and a reload didn't help.
- Not fixed, separate: in production the store's 404 page (a path no route matches) has none of the security headers
  (no CSP, `X-Content-Type-Options`, `X-Frame-Options` or HSTS; `/` has all four). The root middleware doesn't run
  when no route matches. Low risk: the page shows nothing the visitor typed. Every 404 page is also kept 10 minutes
  (`max-age=600`), e.g. a product URL visited before the product is published.

### Done and verified
- `app/routes/missing-asset.ts`, routed as `assets/*`: a missing `/assets/` file gets a 404, `text/plain`,
  `Cache-Control: no-store`, body `Not found`. Hosting still serves every real file before the rewrite.
- 2 unit tests (the response; every `/assets/` path goes there, other paths don't); 6 of 6 mutations caught.
  `npm test` 154 passed; typecheck and lint clean (lint's warnings are in older files). Integration tests not run:
  nothing they cover changed.
- The production build through the Hosting and functions emulators (spare ports): a missing file, flat or nested, →
  404 `no-store` `text/plain` with `nosniff`; the real CSS → 200 from Hosting; `/nao-existe-teste` still the 404 page;
  `/health` 200; `/admin/login` 200 with its 21 files 200.

### Deployed and verified
- Commit `6a5d29a`, then `npm run build` from the clean tree, then
  `firebase deploy --only functions:ssr,hosting --project prod` (no `--force`), 03:49–03:51 UTC. Exit 0; both hooks
  ran; `ssr` was updated, then hosting released (52 files, 1 uploaded: the new manifest); no prompt and no invoker
  warning.
- Live checks:
  - A made-up `/assets/` name, requested twice → 404 `no-store` `text/plain`, `x-cache: MISS` both times. The name the
    CDN had kept before the deploy (`HIT`, `max-age=600`) now gets the same answer: the release cleared it. Firebase
    passes an explicit `Cache-Control` through on a 404.
  - `/`, a product page and `/health` 200; `/admin` and `/admin/settings` 302 → login; `/admin/login` 200 with its 21
    files 200; `/checkout` shows the closed notice; `/robots.txt` identical to the deployed file; `/favicon.ico` 301;
    the entry script and the new manifest `immutable`; the store's 404 page unchanged (`max-age=600`).
  - A fresh load of `/admin/login` in the owner's Chrome: styled, both buttons enabled, its files 200, no console
    errors.

### Not verified
- The function log after this deploy: the Logs Explorer query in the handoff ("Redeploying") with
  `timestamp>="2026-11-04T03:49:00Z"`.
- The deploy gap itself stays: a page loaded in those seconds is still broken, but a reload now fixes it. Closing the
  gap means keeping the previous build's files in each upload (not planned).

### Found later: why only the custom domain stayed broken
- The owner saw it again, only on `https://lojaiyanifa.com.br` (proxied by Cloudflare); `web.app` worked. Reproduced
  in the owner's Chrome: `/admin/login` unstyled, both buttons grey. No service worker.
- The browser used two files from its own cache as 404s, `root-CgE-lJYb.css` and `root-Bi_S0IFU.js`. Read back with
  `fetch(…, { cache: "only-if-cached" })`: the store's 404 page, `cache-control: max-age=14400`, `date` 01:50:17 GMT,
  `cf-cache-status: HIT`, `age: 253`.
- So: during the deploy of `2b7e6ec` (about 01:46 GMT) a request for the new files reached the function before Hosting
  had them. Cloudflare's edge kept that 404 (Firebase's `max-age=600`). At 01:50 the owner's browser got it from the
  edge, and Cloudflare's Browser Cache TTL (4 hours) raised `max-age=600` to `max-age=14400`. The browser keeps those
  404s until about 05:46 GMT (02:46 in Brazil): F5 doesn't help, Ctrl+Shift+R does.
- Cloudflare raises every shorter `max-age` on the files it caches to 4 hours (`/robots.txt` and `/favicon.svg`:
  `max-age=3600` on `web.app`, `14400` on the custom domain). Since `6a5d29a`, a missing `/assets/` file is `no-store`
  there too (`cf-cache-status: BYPASS`), so a deploy can no longer leave a 4-hour 404.
- Cloudflare doesn't cache the HTML pages today (`cf-cache-status: DYNAMIC`), so the `Cloudflare-CDN-Cache-Control`
  header in `docs/architecture.md` §2 has no effect. If HTML caching is turned on there, every deploy must purge it: a
  cached page points to files the new deploy no longer has.
- Changed by the owner the same night, in the Cloudflare dashboard: Caching → Configuration → Browser Cache TTL →
  "Respect Existing Headers". Checked at 05:16 GMT: on every path tried (`/robots.txt`, `/favicon.svg`, two assets, a
  made-up asset, `/`, `/admin/login`, `/health`, the 404 page) the custom domain sends the same `Cache-Control` as
  `web.app`. In the owner's Chrome the custom domain's admin pages load styled, with no console errors.

### Owner's first production sign-in
- Done on the custom domain: the authenticator enrolment, then a sign-in with its code (owner confirmed). Seen in the
  owner's Chrome afterwards: `/admin/login` went straight to `/admin/orders`, signed in as the owner, styled, with no
  console errors. Checklist: "Two-factor authentication for administrators" is done (125 done / 367 open / 14 N/A).

## Session 5, after midnight (2) — 2026-11-04: the 404 page gets the security headers

### Done and verified
- `app/routes/not-found.tsx`, routed as `*`: a path no other route takes now matches it. Its loader and action throw
  a 404, so the request passes through the root middleware (security headers) and the root ErrorBoundary renders the
  same 404 page as before. It keeps a component that never renders: without one it would be a resource route, and the
  404 would go out without the page. The root loader now runs for these paths too (`getContent()` is kept per Prismic
  release; the release is re-checked at most every 10 s).
- 3 unit tests (routing: unknown paths go there and the known ones don't; a 404 for every method; the component). The
  missing-asset test's `/assetsx/a.css` now expects the catch-all. 6 of 6 mutations caught. `npm test` 157 passed;
  typecheck clean; lint: 2 more `only-export-components` warnings, the same pattern as every route module (65 in 23
  files).
- The production build through the Hosting and functions emulators (spare ports): `/nao-existe-teste`,
  `/admin/xyz-teste` and a POST to `/nao-existe-teste` → 404, the store's 404 page, with `nosniff`, `X-Frame-Options`,
  `Referrer-Policy`, COOP, `Permissions-Policy`, the CSP and HSTS (before: none). An unknown product (which already
  had them), `/`, the missing-asset 404, `/health` and `/admin/login` (23 of 23 files) are unchanged.

### Deployed and verified
- Commit `58d92bd`, then `npm run build` from the clean tree, then
  `firebase deploy --only functions:ssr,hosting --project prod` (no `--force`), 06:34–06:35 UTC. Exit 0; both hooks
  ran; `ssr` was updated, then hosting released. 55 files, 41 uploaded: the new route made the bundler re-split the
  shared code into two new chunks (`rolldown-runtime-…`, `components-…`), so most JavaScript file names changed; the
  CSS didn't. No prompt and no invoker warning.
- Live checks on `web.app` and on the custom domain:
  - `/nao-existe-teste`, `/admin/xyz-teste` and a POST to `/nao-existe-teste` → 404, the store's 404 page, with
    `nosniff`, `X-Frame-Options: DENY`, the CSP and HSTS (before: none); `max-age=600` as before.
  - An unknown product the same; `/` and a product page 200; `/admin` 302; `/health` 200; `/robots.txt` identical to
    the deployed file; `/favicon.ico` 301; a made-up asset 404 `no-store`; `/admin/login` 200, its 23 files 200 and
    `immutable`.
- The custom domain's 404 page in the owner's Chrome: styled, and no console message at all while it loaded (nothing
  blocked by the CSP).

### Not verified
- The function log after this deploy: the Logs Explorer query in the handoff ("Redeploying") with
  `timestamp>="2026-11-04T06:34:00Z"`.

## Session 5, early morning — 2026-11-04: Pix and delivery saved; checkout is open

### Owner's actions
- The owner saved the Pix and delivery settings in production's Configurações (the owner's report; not looked at
  here, since the page shows the Pix key).

### Verified (06:46 GMT, both hosts, read only)
- Checkout is **open**: `/checkout` no longer shows the "temporariamente indisponível" notice. Its loader drops the
  notice only when `settings/store.checkoutOpen` is true, the Pix key parses and at least one delivery method is on,
  so the settings are valid too. The page shows the Pix and "Entrega" sections and no "Retirada" (pickup looks off).
  Not opened by Claude; whether opening it was meant: asked.

### Found
- Checkout (its terms checkbox and the footer) links to `/terms`, `/privacy`, `/returns`, `/shipping`, `/cookies`,
  `/about` and `/faq`: all 404, because their Prismic `page` documents aren't published. `/contact` answers 200.
  Customers can order while the terms they must accept, the privacy policy and the returns policy aren't online.

### Not verified
- Whether the owner read the R$ 1,00 test code in the bank app (it checks that the key reaches the right account).
- The order tabs other than "Aguardando pagamento"; a second device for the authenticator.

## Session 6 — 2026-11-04 (night): legal texts, FAQ, e-mail; accounts, support, discounts, reviews

### Owner's request and ground rules
- Asked (before going to bed, "go ahead with any recommendation"): §8 customer accounts, §11 discounts, §12 reviews,
  §13 support, §18 legal (texts for each page and the FAQ), e-mail through **Brevo SMTP**, using the Prismic API (or
  Chrome) to create and update content.
- Ground rules Claude kept, since nobody could approve anything overnight: work on the branch
  `feat/accounts-support-promos-legal` (master untouched, nothing pushed); **no deploy**; no `--production` script and
  no write to the real Firestore/Auth; Prismic writes only through the Migration API, whose **Migration Release must be
  published by the owner** — nothing went live.

### A. Store texts → Prismic Migration Release (commit `d7129be`)
- Texts in `content/prismic/` (pt-BR): `pages/{terms,privacy,cookies,returns,shipping,warranty,about}.md`, `faq.md`
  (24 questions), `settings.md` (the three policy summaries + store name + default meta description).
  - Written to be true for production **today** (guest checkout, Pix only, automatic cancellation, flat rate/pickup);
    no mention of features that aren't deployed, except conditional sentences ("se você criar uma conta").
  - Legal grounds checked against planalto.gov.br on 2026-11-04: CDC arts. 18 §1, 26, 49, 50, 101 I; Decreto
    7.962/2013 arts. 2, 4 (5-day answer), 5; LGPD arts. 5 II, 7, 11 II, 18, 19, 33, 41, 48; Marco Civil art. 15;
    ANPD Res. 2/2022 art. 11 (small agents: no DPO needed, a contact channel is).
  - The privacy policy has a **sensitive-data clause**: most products are religious items, so purchase history can
    reveal religious conviction (LGPD art. 5 II); it commits to no ad targeting/profiling with it. Adding Meta Pixel
    or similar (§15) would contradict it: consent + policy change first.
- Pipeline: `scripts/prismic/markdown.mjs` (Markdown subset → rich text, throws on anything it can't represent),
  `content.mjs` (checks every field against `customtypes/`), `seed-content.mjs` (dry run by default; two passes with
  every created ID recorded in `content/prismic/migration-ids.json` so a failure resumes; never overwrites a published
  or completed document without `--overwrite`; never touches an existing settings document; `--adopt`, `--skip`).
  21 unit tests incl. one that parses the real content files; 4 of 4 mutations caught.
- **Sent** (`--apply`): 7 pages created; the FAQ filled into an existing **empty draft** (`aukFxxEAACoApfqD`, "Untitled
  Nov 2", checked empty in Chrome: placeholder title, one blank item) with `--adopt`, because the FAQ type allows one
  document; **settings skipped**: an **archived** settings document exists (`audNGREAACoAomV3`, "Untitled Nov 1"), which
  blocks a new one. Verified in the Prismic UI: 8 documents "Planned" in "migration-api-release"; the privacy page's
  links: `/contact` relative, `https://www.gov.br/anpd`, document links with the right IDs; the FAQ shows 24 questions.
- Found: the Content API token can't see releases (refs list only Master), so release content is checked in the UI.
- Found: the FAQ now has two versions: the old empty draft ("Edited Nov 2") and the release version. After publishing
  the release, discard that old draft, or publishing it later would empty the FAQ.

### B. E-mail through Brevo SMTP (commit after this entry)
- `app/.server/mail/`: `outbox.ts` (`queueMailInTransaction`), `render.ts` (9 templates, pt-BR, HTML + text, every
  value escaped), `html.ts`, `send.ts` (claim → render → send; retries 2/4/8/16 min, 5 attempts; SMTP 5xx and render
  errors fail at once; 72 h expiry; without configuration nothing is claimed). Scheduled function `sendMailOutbox`
  (every 2 min) in `server/app.ts` with the secret `SMTP_PASSWORD`. Index `mail (status, nextAttemptAt)` added.
  Design and reasons: docs/architecture.md §7.
- Hooks (same transaction as the change): order placed (+ store notice to `MAIL_STORE_TO`), Pix confirmed, cancelled
  (store/expiry), shipped, ready for pickup, delivered, tracking changed (only when code/link changed), refunded.
- New orders get `customerLinkToken`; the order page accepts it like the checkout key (`orderTokenMatches`,
  constant-time). The predeploy hook now refuses `SMTP_PASSWORD` in an env file.
- Tests: unit 193 (15 new: renderer, escaping, https-only links, config, STARTTLS/TLS options, token matching);
  integration 82 (11 new in `tests/integration/mail.test.ts`, fake transport); 6 of 6 mutations caught; typecheck
  clean; lint 0 errors; build OK (bundle imports 14 packages, nodemailer added; `sendMailOutbox` exported).
- **Not verified:** a real send through Brevo (no account/key here); the new index in production.
- Oops: commit `9c734eb` left a type error in `tests/unit/mail.test.ts` (tsc ran before the test was written; vitest
  doesn't type-check). Fixed in batch C's commit. Since then: typecheck after writing tests, right before committing.

### C. Customer accounts (§8)
- Server: `app/.server/customer-session.ts` (14-day cookie, recent sign-in, revocation; `verifyRecentSignIn` for
  deletion), `account-guard.ts` (middleware gate for `/account/*`), `customers.ts` (profile + consents with history,
  addresses, orders by UID / verified e-mail, wishlist, JSON export, deletion keeping orders), audit actions
  `customer.data_exported` / `customer.account_deleted` (actor `{ type: "customer", name: uid }`).
- Pages: `/register`, `/login`, `/forgot-password`, `POST /logout`, `/orders` (301), `/wishlist`, `/account` (overview,
  completing an interrupted registration), `/account/orders[/:number]`, `/profile`, `/addresses`, `/security`,
  `/privacy`, `/export`; `/api/wishlist`. The guest order page's view moved verbatim into
  `app/components/order-view.tsx` (shared with the account) and gained a discount row and a "precisa de ajuda" link.
  Checkout: signed-in prefill, saved-address picker, order linked to the account, "Já tem conta? Entrar".
- Browser SDK (`app/.client/firebase.ts`): `createAccount`, `confirmPassword`, `changePassword`, `resendVerification`.
- Found in Chrome and fixed: a password change revokes the old cookie, so its new ID token must go to `/login`'s action
  (the account gate would already refuse it); after saving an address the confirmation was off-screen; after a password
  change the button stayed on "Trocando…" with the fields filled.
- Tests: unit 205 (12 new: forms/redirects, wishlist three-way merge), integration 93 (11 new in
  `tests/integration/customers.test.ts`), full suite green; a mail test that compared e-mails queued by one transaction
  in Firestore's (random ID) order was flaky — now sorted, 3 runs green. typecheck clean; lint 0 errors; build OK.
- **Chrome on a separate dev stack** (`firebase.verify.json`: Firestore 8480, Auth 9095, hub 4410, logging 4510; dev
  server :5176; Banco Central test key; Q's :5173 stack untouched — checked with netstat):
  rejected registration form → no Firebase account; registration → `/account`, profile + consents + welcome e-mail +
  verification e-mail (emulator); address with ViaCEP fill; checkout prefilled → order 1001 with `customer.uid` and
  `customerLinkToken`; account order list/detail; wishlist synced to `wishlists/{uid}`; password change (wrong current
  refused; session kept; old password refused at the next sign-in); sign-out → gate → sign-in with `redirectTo`;
  export over HTTP (headers, keys, CPF present, 302 without a session); deletion (unticked refused; data and sign-in
  gone; order kept; audit by UID); reset e-mail only for an existing address, same message for an unknown one;
  profile save with consent history.
- Not verified: clicking the verification link (then signing in again to see guest orders) in a browser; the reset link
  itself; the account pages on a phone width; anything in production (not deployed).

### D. Customer support (§13) and return requests
- `app/lib/support.ts` (topics, return reasons/preferences, statuses, form schema, `botReason`), `app/.server/support.ts`
  (tickets numbered from 1001; creation with hourly limits + automatic confirmation e-mail + store notice in one
  transaction; admin list/count/reply/close/reopen, audited `ticket.*`; the customer's tickets by UID / verified
  e-mail). Mail templates `ticket_received` (withdrawal → the art. 5 §4 confirmation wording), `store_new_ticket`,
  `ticket_reply`; mail context gained the business hours. Capabilities `support.view` / `support.reply` (whole team).
  Index `tickets (status, number desc)`.
- Pages: `/contact` (form; `?pedido=&assunto=` fill it in; the action's answer is `no-store` while the page stays
  public), `/admin/support` + `/admin/support/:number` ("Atendimento" in the admin nav), `/account/support[/:number]`;
  order pages link "Pedir troca, devolução ou desistência".
- Tests: unit 216 (contact form 6, support e-mails 5), integration +8 (`tests/integration/support.test.ts`).
- Chrome (dev stack :5176): return request from an order link (fields filled; missing reason/preference → errors;
  sent → "atendimento nº 1001"; ticket + `ticket_received` with `withdrawal` queued; rate-limit docs hold hashes only);
  an instant (bot-like) submit refused; admin (dev owner) → inbox, ticket page with the return details and the
  withdrawal guidance, reply → "Respondido" + `ticket_reply` queued + `ticket.replied` audited, close → counts moved.
  Found and fixed: textareas had the inputs' pill radius.
- Not verified: staff's view in a browser (capability table only); the 5-day overdue flag; a signed-in customer's
  ticket list in a browser (integration only).

### E. Discounts and promotions (§11)
- Engine `app/lib/discounts.ts` (pure): percent / fixed / free shipping / buy X get Y; scope all / products (+ "kit":
  all required) / categories; schedule, minimum, total and per-customer limits, first order, allowed e-mails; one
  products discount (best for the customer) + one free shipping; provisional while the buyer is unknown (the cart).
- `app/.server/promotions.ts`: Firestore mapping, reads inside the order transaction, the buyer's earlier orders by
  e-mail **and** CPF, `redemptionCount` up at order time and down when the unpaid order is cancelled (store or expiry,
  in `settleInTransaction`), admin save (audited `promotion.created/updated`). `app/lib/admin/promotions.ts` parses
  the admin form (R$ decimals, Brasília datetime-local).
- `createOrder`: discounts decided in the transaction; `CouponRefusedError` (409 at checkout, "continuar sem o cupom");
  totals keep the products discount and the charged shipping; a R$ 0,00 total is refused. Quote API previews with
  the same engine; cart coupon box (code kept in `li.coupon.v1`); checkout summary + coupon status.
  `/admin/discounts` (+ new/edit; "Descontos" in the nav; capability `discounts.manage`: owner/admin). The admin order
  page says when the customer paid nothing for delivery.
- Tests: unit 236 (engine 14, admin form 6), integration 108 (7 new: coupon totals and Pix amount, refused coupons
  write nothing, first order by CPF, free shipping on top, better automatic wins, **race for the last use** (6 runs
  green), cancellation and expiry give the use back). Mutations: 6 meaningful caught; one survivor showed the explicit
  tie-break was dead code (the coupon is always the first candidate) — simplified to what the test pins.
- Chrome (dev stack): created `BEMVINDO10` (10%, first purchase) and an automatic free shipping above R$ 100; cart →
  free shipping, then the coupon (typed lowercase) → −R$ 12,99, total R$ 116,91 with the "confirmed at checkout"
  note; checkout with the CPF of order 1001 → refused with the reason; with a new CPF → order 1002, Pix R$ 116,91;
  counters 1/1; cancelled in the admin → 0/0. Found and fixed: the discount amount wrapped in the narrow summary.
  My own slip: clicked hidden cancel controls before opening the "Cancelar pedido…" disclosure.
- Seen: the admin's own `__session` counts as a signed-in customer at checkout (order 1002 shows "Cliente com conta",
  linked to the dev owner). Expected with one session cookie per browser; harmless.

### F. Reviews and social proof (§12)
- `app/lib/reviews.ts` (form, sorting, stats maths), `app/.server/reviews.ts` (submit with "compra verificada",
  moderation with stats in the same transaction, helpful votes, reports, admin lists, deletion with the account),
  `app/.server/ownership.ts` (the order-ownership rule, moved out of customers.ts to avoid an import cycle).
  Audit actions `review.*`; capability `reviews.moderate` (owner/admin).
- Pages: `/products/:uid/review` (signed-in), `POST /api/reviews` (helpful / report), `/admin/reviews` ("Avaliações"),
  the reviews section on product pages (`app/components/reviews.tsx`), Product JSON-LD `AggregateRating` + `Review`
  only with approved reviews. Account export and deletion include reviews.
- Tests: unit 242 (6 new), integration 113 (5 new); 3 of 3 mutations caught.
- Chrome (fresh dev stack): customer sign-in with `redirectTo` straight to the form; review with a YouTube link →
  pending (not on the page); owner publishes → stars, 5,0 average, distribution, youtube-nocookie player, JSON-LD
  rating; "Útil" twice → 1; report → "Denunciadas 1".
- **Found: Vite caches a route file that `routes.ts` names before the file exists** (as in session 2). I registered
  `admin.reviews.tsx` a moment before writing it, so my dev stack had to be restarted — and **Q's old :5173 dev
  server, which hot-reloads this working tree, shows "Failed to load url … wishlist.tsx" since batch C**. Not
  restarted on purpose: it runs inside `emulators:exec`, so stopping it would end its emulators and lose Q's dev data
  (order 1003). Restart it whenever convenient (`npm run dev:emulated`). Lesson: write the route file first.

### G. Cookie consent (§18)
- `app/lib/consent.ts` (`li.consent.v1`, versioned; `hasConsent()` for any future analytics/marketing tool; never
  assumes consent), `app/components/consent.tsx` (non-blocking notice that says only essential cookies/storage are
  used; "Preferências de cookies" dialog, analytics/marketing off unless chosen), mounted in the store layout; footer
  link + "Garantia" added to the footer's legal column. 2 unit tests.
- Chrome: notice on first visit; dialog (found and fixed: Tailwind's reset left `<dialog>` in the top-left corner →
  `m-auto`); saved both off → notice gone, choice stored; reopened from the footer with the saved state; Escape
  closes it.
- `content/prismic/pages/cookies.md` now also lists the keys this branch adds and the preferences link. **Not sent**:
  the copy in Prismic's release must stay true for production until the branch is deployed (handoff, step 5).
- `seed-content.mjs` learns `external` state entries; the archived settings document is recorded as one, so a plain
  `--apply` skips it with the reason.
- The final `npm run build` caught a batch D bug that dev mode and typecheck don't: `admin.ticket.tsx` imported
  `REPLY_MAX` (used by the form) from the server-only `~/.server/support` ("Server-only module referenced by
  client"). The constant moved to `app/lib/support.ts`; build OK. Lesson: run the build after every batch.
- Intermittent test, seen once: in the first full integration run at the end, `orders.test.ts` › "never sells the
  last unit twice, even to simultaneous buyers" got `3 INVALID_ARGUMENT: Transaction is…` (Vitest cut the message)
  instead of `CartChangedError`, after 8.3 s. No order code had changed since the last green run (`git diff 3db05c5`);
  the test then passed 3/3 alone and the next full run passed 113/113. Theory, unverified: the emulator answers
  INVALID_ARGUMENT (not retried by the SDK) to a transaction that lost a slow lock race, where production answers
  ABORTED (retried). If it comes back, capture the full error before changing the test or the order code.

### H. Brevo live check and a sender fix (afternoon, with the owner)
- The owner published the Migration Release (verified: the 7 pages and the FAQ answer 200 on both hosts), restored
  and partly filled the settings document, and created the Brevo account (domain records checked by DNS lookup).
- The SMTP settings were in a root `.env`, which nothing reads (dev reads `.env.local`, deployed functions read
  `.env.lojaiyanifa`). `.env.example` (committed) also held the real SMTP login and key: never committed (no commit on
  any branch has an SMTP-key-shaped string); restored to its placeholders. With the owner's yes, the settings were
  copied into `.env.local` and, without the key, `.env.lojaiyanifa` (passes the predeploy rules). The root `.env` is
  unused and can be deleted.
- Live send through the production path (one fake order on the test emulator; its two e-mails to `MAIL_STORE_TO`
  only): refused at login, `525 5.7.1 Unauthorized IP address`, three times, also after the owner turned Brevo's IP
  blocking off; **passed once the owner authorized this machine's IP** in Brevo. Production is still affected: see
  the handoff, step 4. The check is now a command: `npm run test:mail-live` (`tests/mail-live/`, its own vitest
  config; the unit and integration runs never include it). It prints what it sent: Vitest 5 hides a passing test's
  console output, so its config sets `silent: false` (the passing run above printed nothing; checked with a marker test).
- **Bug the live send found (batch B):** every SMTP 5xx counted as "this e-mail is refused for good", but Brevo also
  answers 5xx at login, so a blocked IP or a wrong key would have failed every e-mail at once, for good. Now
  `sendErrorKind` (nodemailer's code and SMTP command, checked in its source) decides: only a refused recipient
  (RCPT TO) or content (EMESSAGE) is the e-mail's problem (5xx final, 4xx retried); login, sender, connection, TLS and
  timeouts are the service's: the e-mail goes back without using an attempt, waits 5 minutes, the run stops
  (`blocked`, logged as an error) and the next runs try again until the 72-hour expiry. Unit tests (classifier) and an
  integration test (an hour-long login outage, then recovery); mutation check: each of 5 mutations caught by the unit
  or the integration tests. Seen live: the refused runs left both e-mails pending with no attempt used.

## Session 7 — 2026-11-06: `/llms.txt` and LocalBusiness JSON-LD

### Owner's request
- Add an `llms.txt` and a LocalBusiness JSON-LD, both pasted by the owner (generated elsewhere). Both carried the store
  phone (the WhatsApp link, `telephone`), so neither is a static file: both are built from the Prismic settings at
  request time, like the footer.
- Then the owner's choice (the pasted JSON-LD had no address, which Google requires for a LocalBusiness): keep
  LocalBusiness, with the physical store's address, the store at Mercadão de Madureira. The Prismic company address
  (Street address, City, State, CEP) already holds exactly that address, so the JSON-LD reads it. Commit and deploy.

### Done and verified
- `app/lib/store-profile.ts`: the owner's description and four offerings as fixed text (the paste's "Panas tradicionais"
  corrected to "Panos"); `localBusinessJsonLd(settings, siteUrl)` (`telephone` = `contact.phone` normalized to +55…,
  `address` = a PostalAddress from the company address with country BR, only when a street address is set and without
  the parts that are empty, `sameAs` = the social links; each left out when empty); `llmsTxt(...)` (home + about +
  every catalog product under its page title, sorted pt-BR; profiles = the social links, network lowercased, + the
  WhatsApp link with its message; a closing `Website:` line).
- `/llms.txt` (`app/routes/llms-txt.ts`, registered after `sitemap.xml`): `text/plain; charset=utf-8`,
  `public, max-age=0, s-maxage=3600`. A route works in production: on 2026-11-06 the live `/llms.txt` 404 was the
  store's own 404 page, so the request reaches the app (unlike `/robots.txt`, which the Functions Framework answers).
- Home page: the bare `Organization` block is replaced by the LocalBusiness block (a LocalBusiness is an Organization;
  one entity, not two). `WebSite` unchanged.
- Tests: 5 unit (`tests/unit/store-profile.test.ts`), 13 of 13 mutations caught. Totals: unit 252 (32 files),
  typecheck 0 errors, lint 0 errors, build OK.
- Against the live Prismic content (GET requests to the :5173 dev server only): `/llms.txt` differs from the paste only
  by one blank line, "Panos", and the product list: all 32 catalog products (the sitemap's set) instead of 10. The
  profile lines, phone included, are identical. The home JSON-LD has the paste's fields and values (dev origin aside),
  plus the address exactly as typed in Prismic (street, Rio de Janeiro, RJ, CEP, BR).
- Owner-data scan: 0 hits (the changed files: phone, owner e-mail, 13 env values; 259 committable files: phone).
- Checklist: the note of "Structured data / Schema.org" now says LocalBusiness (was Organization).

### Notes
- The LocalBusiness address is the company address, the same one the footer shows. Should the registered (legal)
  address ever differ from the store's, the store needs fields of its own (comment in `app/lib/store-profile.ts`).
- Prismic's street address has a space after the hyphen in the stall numbers; footer and JSON-LD show it as typed.

### Deployed 2026-11-06 (owner's go)
- From `5e643f9`: `firebase deploy --only hosting,functions:ssr --project prod`, 05:34:26 → 05:36:17 UTC, exit 0. Both
  hooks ran (`.env.lojaiyanifa` checked and copied; robots.txt written), `ssr` updated, hosting released, no invoker
  warning. No Firestore change.
- Live on both hosts: `/llms.txt` 200 `text/plain; charset=utf-8`, `public, max-age=0, s-maxage=3600`, 32 products,
  the same differences from the paste as on dev (custom domain: `cf-cache-status: DYNAMIC`, no stale 404). Home page:
  the LocalBusiness block with the address, `url` `https://lojaiyanifa.com.br/` and the paste's phone; no Organization
  block. The standard checks pass on both: `/products/alaka`, `/sitemap.xml`, `/health`, `/robots.txt` 200; `/admin`
  302 to the sign-in; `/favicon.ico` 301; an asset `immutable`; a made-up asset 404 `no-store`; an unknown path 404 with
  `nosniff` and the CSP.
- Not checked: the function log (no gcloud on this machine). Logs Explorer:
  `resource.type="cloud_run_revision" AND resource.labels.service_name="ssr" AND timestamp>="2026-11-06T05:34:00Z"`.
- Not pushed: the owner asked for commit + deploy. The branch is still not merged into master.

### Opening hours (the owner's ask, after that deploy)
- `localBusinessJsonLd` adds `openingHoursSpecification` from the Prismic business hours (the footer's): one entry per
  distinct time slot, its days Monday first (as the footer lists them), times as hh:mm:ss (Google's stated format; the
  settings keep hh:mm). A split shift becomes two entries; no hours, no property.
- Tests: 6 unit, 20 of 20 mutations caught. Totals: unit 253 (32 files), typecheck 0 errors, lint 0 errors, build OK.
  Dev server (:5173, GET only): Monday–Saturday 10:00:00–18:00:00, as the footer shows it ("segunda a sábado,
  10:00–18:00").
- **Deployed** from `e48aec3`: `firebase deploy --only hosting,functions:ssr --project prod`, 06:23:14 → 06:25:03 UTC,
  exit 0; both hooks ran, `ssr` updated, hosting released, no invoker warning. Live on both hosts: the LocalBusiness
  block has Monday–Saturday 10:00:00–18:00:00, with the address, phone and profiles as before; `/llms.txt` and the
  standard checks unchanged and passing (same list as above). Function log not checked (no gcloud; same query, from
  `2026-11-06T06:23:00Z`). Not pushed.

## Session 8 — 2026-11-06: the content pages were a 404 on a click

### Owner's report
- A click on Entregas, Trocas e devoluções, Política de privacidade, Termos de uso, Política de cookies or Garantia (in
  the footer), or on the cookie notice's "Política de cookies", showed the 404 page; a reload showed the page. Dev and
  production.

### Cause (verified)
- Not the links: the loader of `app/routes/page.tsx`. A click loads no document: React Router fetches the loader data
  from `/shipping.data`. React Router 8 (8.5.1) gives loaders that raw request (`request.url` =
  `/shipping.data?_routes=…`) and, separately, `url`: the page's own address, without `.data` and `_routes`
  (`callLoaderOrAction` in `node_modules/react-router/dist/development/lib/router/router.js`; documented on
  `DataFunctionArgs.url` in `lib/router/utils.d.ts`). The loader looked the uid up by `new URL(request.url).pathname`,
  so `/shipping.data` found no page and threw the 404. On :5173 before the fix: `/shipping` 200, `/shipping.data` 404
  (`page-shipping` matched; its loader threw).
- The same line had a second effect: a generic page at `/pages/:uid` answered a click with a 301 to its own address
  (`/pages/x.data` ≠ `/pages/x`).

### Fix (done and verified)
- `app/routes/page.tsx` reads `url` instead of `request.url`.
- Tests: 3 unit (`tests/unit/content-page.test.ts`: the loader called with the arguments a click produces). Tests 1 and
  2 failed before the fix (the 404; the 301 to itself) and pass after; test 3 pins `/pages/privacy` → 301 `/privacy`.
  Totals: unit 256 (33 files), typecheck 0 errors, lint 0 errors, build OK.
- :5173 (GET only): the 7 pages answer both the document and the `.data` request with 200.
- Chrome on the verify stack (:5176, emulators 8480/9095/4410, no seed: these pages come from Prismic): a real click
  on the footer's Entregas, then the other 6 footer links (`a.click()`), then a real click on the cookie notice's link
  (the notice was shown by removing `li.consent.v1` for :5176; the value was restored byte for byte afterwards). Each
  showed its page title and no 404; every navigation was client-side (a `window` marker survived); each
  `/<page>.data?_routes=root,page-<uid>` answered 200.

### The same cause in three more places (fixed the same day, on the owner's go)
- `app/.server/account-guard.ts`, `app/.server/admin-guard.ts`: a signed-out click on a link to a protected page put
  the `.data` address in `redirectTo` (`/login?redirectTo=%2Faccount.data`, seen on :5173; the document request gave
  `%2Faccount`). `safeAccountRedirect` let it through, so signing in sent the visitor to the `.data` address. Both
  build `redirectTo` from `url` now (middleware receives it too: `runMiddlewarePipeline` in `router.js`).
- `app/routes/admin.reviews.tsx` action: the moderation buttons are React Router `<Form>`s, which post to
  `/admin/reviews.data`; the action redirected to `request.url`'s path, so each approve/reject/delete/reply was saved
  and then sent the admin to `/admin/reviews.data?…` (from the code and the test; not run in a browser). It redirects
  to `url` now.
- Tests: 3 unit (`tests/unit/auth-guards.test.ts`: 2; `tests/unit/admin-reviews-action.test.ts`: 1), each failing
  before its fix (`redirectTo=%2Faccount%2Forders.data%3Fpagina%3D2%26_routes%3Droot`, the admin's alike;
  `/admin/reviews.data?status=reported`) and passing after. Totals: unit 259 (35 files), typecheck 0 errors, lint 0
  errors (warnings unchanged).
- :5173 (GET only, signed out): `/account.data` → `/login?redirectTo=%2Faccount`;
  `/account/orders.data?pagina=2&_routes=root` → `redirectTo=%2Faccount%2Forders%3Fpagina%3D2`;
  `/admin/orders.data?status=open&_routes=root` → `/admin/login?redirectTo=%2Fadmin%2Forders%3Fstatus%3Dopen`. The
  document requests are unchanged.
- Fine by accident, left as they are (prefix checks that `.data` doesn't break): `categories.tsx`, `category.tsx`,
  `security.ts`. The other `request.url` readers use only `searchParams`.
- Not checked in a browser: the moderation redirect (it needs an admin sign-in and a review to moderate).

### Notes
- One real click on the cookie notice's link made two `/cookies.data` requests (both 200); the footer clicks made one
  each. That link has no `prefetch`, and `app/` has no revalidation hook. Cause unknown; not investigated.
- The verify stack after `TaskStop`: :5176 answered 000, but 8 processes were alive (the Firestore java, the firebase
  node holding Auth and the hub, and 5 of the `react-router dev` chain). `taskkill /PID <the sh.exe root> /T /F` ended
  them all; ports 000 after; :5173 untouched (200).
- Not deployed yet.

## Handoff for the next session (read this first)

**Session 8 (2026-11-06): four places read `request.url`, which on a client-side navigation is React Router 8's raw
`.data` request: the content pages (a 404 on every click from the footer or the cookie notice), the account and admin
sign-in `redirectTo`, and the reviews moderation redirect. All four read `url` now (+ 6 unit tests), verified on dev
and in Chrome; not deployed yet. See "Session 8" above.**

**Session 7 (2026-11-06): `/llms.txt` + the LocalBusiness JSON-LD (store address, opening hours), deployed at 05:36
and 06:25 UTC (last from `e48aec3`, `ssr` + hosting; not pushed); see "Session 7" above.**

**Session 6 (2026-11-04 and 05) — branch `feat/accounts-support-promos-legal`: pushed to origin and deployed to
production on 2026-11-05 (04:17 UTC, from `41e6cf8`; `ssr` + hosting again at 05:08 UTC, from `a099e30`); not
merged into master yet** (pull request:
`https://github.com/ayodkay/lojaiyanifa/pull/new/feat/accounts-support-promos-legal`).
Commits on top of master `1b17582`: `d7129be` texts → Prismic, `9c734eb` Brevo e-mail, `33ff768` accounts, `68c6d1f`
support, `b2fd334` discounts, `3db05c5` reviews, `20fb352` cookie consent, then the afternoon's mail fixes and notes
(`git log`).
Checks at the end (after H): unit 246, integration 114 (fresh emulators; one intermittent failure earlier, see G),
typecheck clean, lint 0 errors, build OK.

**What the owner does next, in this order:**
1. **Done 2026-11-04** (the 7 pages and the FAQ answer 200 on both hosts).
   **Prismic → Migration release** ("migration-api-release"): read the 7 pages and the FAQ (lawyer review
   recommended for terms, privacy, returns, warranty), edit freely, then **Publish**. This alone fixes the 404s that
   checkout links to; it needs no deploy. Choices the texts make that are business decisions (change them if wrong):
   exchanges for size/colour at the customer's shipping cost; a re-delivery may be charged when the address was wrong
   or nobody was home; refunds by Pix right after the returned product arrives; the FAQ explains that the bank app
   shows the Pix account holder's name, not "Loja Iyanifa" (session 2 left that open).
2. **After publishing, discard the old empty FAQ draft** ("Untitled Nov 2", same document `aukFxxEAACoApfqD`, shown as
   "Edited" beside the release version): publishing that draft later would empty the FAQ.
3. **Store settings in Prismic** (company name, CNPJ/CPF, address, support e-mail, WhatsApp, hours): the settings
   document is **archived** ("Untitled Nov 1", `audNGREAACoAomV3`). Restore it and fill it in. The three product-page
   policy summaries are ready in `content/prismic/settings.md`: paste them by hand. **2026-11-04: restored and partly
   filled by the owner**, so the `--adopt` route is closed (the Migration API would replace what was typed).
4. **Brevo** (e-mail): add `lojaiyanifa.com.br` as a sender domain and put Brevo's DNS records in Cloudflare
   (DNS only, not proxied); create an SMTP key (SMTP & API → SMTP); then
   `firebase functions:secrets:set SMTP_PASSWORD --project prod` (paste the key), and add to `.env.lojaiyanifa`:
   `MAIL_FROM="Loja Iyanifa <pedidos@lojaiyanifa.com.br>"` (a sender Brevo verified), `SMTP_USER=<Brevo SMTP login>`,
   `MAIL_STORE_TO=<the store's inbox>`, optionally `MAIL_REPLY_TO`. Not ready yet? Set the secret to `unset`: e-mails
   wait (each run logs how many) and expire after 72 h. Optional: Firebase console → Authentication → Templates → SMTP
   settings → the same Brevo relay, so verification/reset e-mails come from the store's domain.
   **Status 2026-11-04:** account, sender domain and DNS done (Zoho MX; Brevo code; DKIM `brevo1`/`brevo2`; DMARC
   `p=reject`); settings in `.env.local` (dev) and `.env.lojaiyanifa` (production, without the key). Sending works
   from the owner's machine since the owner authorized its IP in Brevo (`npm run test:mail-live` passed; it sends one
   fake order's 2 e-mails to `MAIL_STORE_TO` only). Production sends too: Brevo
   accepted the deployed function's first e-mails on 2026-11-05 (step 5). If it ever refuses (`[mail] SMTP refused …
   525 5.7.1 Unauthorized IP address` in the log; the e-mails wait up to 72 hours), check Brevo → Security →
   Authorized IPs: Cloud Functions have no fixed IP. The production secret
   was set on 2026-11-05 (version 1; create it with `--project prod`: the repo's default project is the demo one).
5. **Deployed 2026-11-05** from `41e6cf8`, on the owner's go (the branch is not merged into master yet):
   - Firestore: indexes `mail` and `tickets` deployed and READY; the rules were unchanged.
   - `firebase deploy --only hosting,functions`: hooks OK (`.env.lojaiyanifa` copied without the key, robots.txt from
     `SITE_URL`), the functions' service account got access to the secret, `ssr` and `expirePixOrders` updated,
     `sendMailOutbox` created (revision `sendmailoutbox-00001`), hosting released; no invoker warning.
   - Live on both hosts: every page 200 (legal pages, FAQ, `/register`, `/login`, `/forgot-password`, `/contact`,
     `/wishlist`, a product page with its reviews section), `/admin` and `/account` 302 to their sign-in pages,
     `/health` 200, immutable assets, a made-up asset 404 `no-store`, an unknown path 404 with the security headers;
     canonical links, the sitemap and robots.txt name `https://lojaiyanifa.com.br`.
   - Logs (Logs Explorer, first hour): no errors; the only warnings were the checks' own 404s and a scanner asking for
     `/.env` (404). `firebase functions:log --only ssr` showed a stale slice again, while `--only sendMailOutbox` (a
     new function, little history) was current.
   - The updated cookie policy (dated 2026-11-05) is in the Migration Release: **the owner publishes it**.
   - **E-mail from production works.** A test contact message on `lojaiyanifa.com.br/contact` (ticket 1001,
     2026-11-05 04:50 UTC, the store inbox as the customer address, on the owner's go): the next run logged
     `[mail] sent 2` at 04:51:02 UTC (the auto-reply and the store notice); no errors. Read it in the Logs Explorer
     (search `"[mail]"`): `firebase functions:log --only sendMailOutbox` went stale within the hour, like `--only ssr`.
     The owner closes ticket 1001 in `/admin/support`.
   - Then the store phone's formatting (`9514e39`: contact page and footer show `(DDD) number` and link `tel:+55…`;
     they printed the Prismic text as typed) went out from `a099e30` at 05:08 UTC (`--only hosting,functions:ssr`);
     checked on both hosts.
   The procedure, for next time:
   `firebase deploy --only firestore --project prod` (new indexes `tickets (status, number desc)` and
   `mail (status, nextAttemptAt)`; wait for READY), then `npm run build` from a committed tree, then
   `firebase deploy --only functions,hosting --project prod > <log> 2>&1` — this creates the new scheduled function
   `sendMailOutbox`, which needs the secret from step 4. Then send the cookie policy that matches the deployed site:
   `node scripts/prismic/seed-content.mjs --apply --overwrite cookies` and publish the release again. Live checks as in
   "Redeploying" below, plus `/register`, `/login`, `/contact` (form), `/wishlist`, a product page's reviews section.
6. Recommended, not built: Cloud Logging retention ≥ 183 days (the privacy policy promises 6 months of access logs,
   Marco Civil art. 15; the default bucket keeps 30); a Firestore TTL policy on `rateLimits.expiresAt`; Cloudflare
   Turnstile keys for the contact form.
   **`SITE_URL` is `https://lojaiyanifa.com.br`** since 2026-11-04 (owner's decision, in `.env.lojaiyanifa`; the
   predeploy check passes): canonical URLs, the sitemap, robots.txt and e-mail links switch at the next functions +
   hosting deploy. `lojaiyanifa.web.app` keeps working: the same-origin check compares a form's Origin with the
   forwarded host (a POST to `/` reached the router, 405, on both hosts). After the deploy, check the canonical link
   and `/robots.txt` on both hosts (Cloudflare may serve `.com.br` from cache for a while).
7. This machine: Q's old dev server on :5173 shows "Failed to load url … wishlist.tsx" since this branch changed
   `routes.ts` under it; restarting it ends its emulators and their data (order 1003). Start fresh with
   `npm run dev:emulated` when convenient. Claude's verification stack (`firebase.verify.json`, dev server :5176) was
   stopped at the end of the session (its ports no longer answer; :5173 and :8180 were left as they were).

**Still open from tonight's scope (needs the owner):** customer photos in reviews (a Storage bucket + an upload path
that strips EXIF), gift cards / loyalty points / referrals (rules), NF-e invoices (accountant), live chat (WhatsApp is
the channel; a widget means a third party + consent), phone support (number), the flat rate's transit days.

**Earlier handoff (sessions 1–5) follows.**
**State:**
- Sessions 1–2: storefront, cart, checkout, orders and Pix codes.
- Session 3: admin sign-in with roles.
- Session 4: TOTP screens (verified on the real project on 2026-11-04), Pix expiry job, fulfilment (preparing →
  shipped / ready → delivered / picked up) with tracking, internal notes, full/partial refunds with stock returns.
- Session 5: production config for the deployed functions; `.firebaserc` `prod` alias; `/admin/users` dropped.
  In the afternoon: first production deploy, owner role, TOTP turned on in the project, `npm run preview` fixed.
  In the evening: `/robots.txt` as a static file written at deploy time, `/favicon.ico` as a Hosting redirect;
  `/healthz` renamed `/health`. Deployed that evening from `7f99658`.
  At night: `/admin/settings` (Pix payment, delivery, and a switch that opens and closes checkout), deployed from
  `2b7e6ec`.
  After midnight (2026-11-04): a missing `/assets/` file gets a short `no-store` 404 instead of the store's 404 page,
  which was kept for 10 minutes. Deployed from `6a5d29a`. The owner's first production sign-in with TOTP worked.
  Then the 404 page for unknown paths gets the security headers (a catch-all route). Deployed from `58d92bd`.
  Early morning: the owner saved the Pix and delivery settings, and checkout is open.
- Everything is verified as listed above.

**Deployed 2026-11-03.** `https://lojaiyanifa.web.app` and the custom domain `https://lojaiyanifa.com.br` (through
Cloudflare) serve the store. Checkout is **open** since 2026-11-04 (seen 06:46 GMT), with the Pix and delivery
settings the owner saved. The owner role is granted and TOTP is on; the owner's first sign-in with it worked on
2026-11-04. Next: the owner's list below, first the policy pages. The evening's
`/robots.txt`, `/favicon.ico` and `/health` change was deployed the same evening, from `7f99658`, and
`/admin/settings` that night, from `2b7e6ec`. On 2026-11-04 the missing-asset 404 followed, from `6a5d29a`, and the
catch-all 404 route, from `58d92bd`.

**Checks:**
- Checklist: 125 done / 367 open / 14 N/A (`ecommerce_master_build_prompt.md`). The update script's "with notes"
  count is the open items that have a note, not all open items. "Robots.txt" went back to todo on 2026-11-03, when
  production answered it with a 404, and was done again that evening, once production served the file.
- `npm test` (157 unit) and `npm run test:integration` (71, own emulator ports via `firebase.test.json`; all passed
  on the night of 2026-11-03).
- `npm run typecheck` and `npm run lint`.

**Git:**
- `master`: `643da9e` baseline → `e418f1b` `.gitattributes` (LF everywhere) → `a3b31d2` admin → `246acfa` handoff
  fixes → `867bed1` session 4 → `2438821` session-5 config → `1b3c384` preview fix + deploy notes → `7f99658`
  robots.txt, favicon, `/health` → the evening's post-deploy notes → `2b7e6ec` `/admin/settings` → `e0a9c87` the
  night's post-deploy notes → `6a5d29a` the missing-asset 404 → its post-deploy notes, 2FA done → `58d92bd` the
  catch-all 404 route (what is deployed) → its post-deploy notes (see `git log`).
- Deployed: `ssr` and hosting from `58d92bd` (2026-11-04, 06:35 UTC). `expirePixOrders` was last deployed from
  `2438821`; its code hasn't changed since.
- Pushed to `origin/master` on 2026-11-04, on the owner's ask, through the commit that wrote this line;
  `git status -sb` shows anything newer. Push only when the owner asks.
- Commit only when the owner asks. Add files by path, never `git add .`.

**This machine:**
- Emulators need Java 21: prefix shell commands with `PATH="/c/Program Files/Microsoft/jdk-21.0.13.21-hotspot/bin:$PATH"`.
- Dev Firestore emulator :8180 (Docker owns 8080), Auth :9099; integration tests use :8280/:9098.
- The session-1 orphan emulator is gone: `npm run emulators` (with UI on :4000) should start again — not tried.
- A dev server + emulators started from Claude's session 2 still ran on 2026-11-03. Its PIDs were
  33300 (firebase), 12220 (java) and 44052/13692/3280 (react-router dev).
  - Command: `emulators:exec … react-router dev --port 5173`, started 2026-11-01 13:52.
  - Claude Code no longer tracks it (memory-pressure reaper, session 5), so stopping it means those PIDs.
  - Probe it with `http://localhost:5173/health` (it was `/healthz` until the evening of 2026-11-03).
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
- The Firebase CLI run from Claude's tools is non-interactive (no TTY). Redirect deploy output to a file
  (`firebase deploy … > log 2>&1`): piped through `grep`, the first deploy lost its last lines.
- This machine's Hosting emulator can't apply redirects written with `source` (a Windows bug in superstatic 10.0.0:
  `/favicon.ico` becomes `\favicon.ico`). Write redirects with `regex`, which production supports too, or check them on
  the live site.
- The old dev server (:5173) checks the checkout switch since the night of 2026-11-03, and its emulator has no
  `settings/store`, so its checkout shows as closed. To open it: sign in at `http://localhost:5173/admin/login` as
  `dono@example.com` and use Configurações → Abrir checkout, or re-run `node scripts/dev/seed-emulator.mjs`, which
  rewrites the settings and resets the three dev users.
- A second, separate dev stack for browser checks: generate a spare-port config (hub 4410, logging 4510, Auth 9095,
  Firestore 8480), run the seed from a folder without `.env.local` (so it uses the Banco Central test key), and start
  `react-router dev --port 5176` inside `emulators:exec`. Shell variables win over `.env.local`. Check with `netstat`
  that the dev server connects to 8480, not 8180, before using it.

**Production config (session 5):**
- Deployed functions read the gitignored root file `.env.lojaiyanifa`. It exists on this machine and was created
  2026-11-03.
- The functions predeploy hook (`scripts/functions-env.mjs`) checks it and copies it into `build/functions/` on every
  functions deploy. A missing or unsafe file stops the deploy.
- The hosting predeploy hook (`scripts/robots-txt.mjs`) writes `build/client/robots.txt` from the same file's
  `SITE_URL` on every hosting deploy, after the same checks.
- What it must contain: `.env.example`, "Production", and `docs/architecture.md` §8.
- The owner's root `.env` is now redundant: nothing reads it.
- Single admin account: the owner. The e-mail is not written here (owner data).

**Done before and during the first deploy (2026-11-03):**
- Blaze plan; Firestore `(default)` in `southamerica-east1`; Email/Password on; owner account created (owner).
- Owner role granted with `grant-role --production --project lojaiyanifa` (it takes the real project ID, not the
  `prod` alias). Credentials: the service-account key through the shell's `GOOGLE_APPLICATION_CREDENTIALS`.
- TOTP turned on in the project's Auth config (it was off).

**Owner's first sign-in: done 2026-11-04** (on the custom domain: enrolment, then a code; owner confirmed). The
checklist item "Two-factor authentication for administrators" is done.
- Back the enrolment up on a second device: with one admin account, a lost phone needs
  `scripts/admin/reset-mfa.mjs --production`.
- If TOTP ever fails: stop and report. Never set `ADMIN_REQUIRE_MFA=false` to get in.
- If the page shows up unstyled with grey buttons, reload it with Ctrl+Shift+R (2026-11-04, "Found").

**Next for the owner** (Pix and delivery saved and checkout opened on 2026-11-04):
1. Publish the Prismic pages that checkout links to: `terms`, `privacy`, `returns`, `shipping`, `cookies`, `about`
   and `faq` (all 404 on 2026-11-04). Customers are asked to accept the terms at checkout.
2. If not done yet: read the R$ 1,00 test code in the bank app without paying, to check the key reaches the right
   account.
3. Open each order tab once (they need the indexes; only "Aguardando pagamento" has been seen), and watch that tab:
   new orders wait there for their Pix payment.
4. Back the authenticator up on a second device.

**Redeploying, on the owner's go:**
1. `npm run build` from a committed tree.
2. `firebase deploy --only hosting,functions --project prod > <log> 2>&1`, then read the log and the exit code.
   - The functions hook prints `.env.lojaiyanifa checked and copied`. The hosting hook prints
     `build\client\robots.txt written from .env.lojaiyanifa`, then the rules.
   - Rules or index changes: `firebase deploy --only firestore --project prod`, and wait for READY
     (`firebase firestore:indexes --project prod --pretty`) before deploying code that needs a new index.
   - Don't run a bare deploy: `firebase.json` also lists Storage, which the app doesn't use.
   - `--force` is no longer needed for the cleanup policy, which now exists. Don't add it by habit: it also approves
     deleting functions that are missing from the source.
3. Checkout: the owner's switch in Configurações (`settings/store`) opens and closes it; it has been open since
   2026-11-04. A deploy doesn't change it, and saving the Pix or delivery settings doesn't either.
4. Check: `/`, a product page, `/admin` → 302, `/robots.txt` (200, the rules), `/favicon.ico` (301 → `/favicon.svg`),
   `/health` (200 JSON), `curl -I` an `/assets/*` file (immutable cache header) and a made-up one (404, `no-store`),
   an unknown path (404 with `X-Content-Type-Options` and the CSP), all on `web.app` and on the custom domain
   (`https://lojaiyanifa.com.br`, through Cloudflare), and the function log in the Logs Explorer, with this query
   (put in the deploy's UTC start time):
   `resource.type="cloud_run_revision" AND resource.labels.service_name="ssr" AND timestamp>="2026-11-03T21:30:00Z"`
   Don't rely on `firebase functions:log`: on 2026-11-03 it showed a stale slice of the log.
5. Stop and report if pages answer 500, or if the deploy warns "Unable to set the invoker" (a Google Workspace
   organization policy would make every page answer 403).

**Not built yet (in order):**
1. Transactional e-mails. Needs an SMTP provider and a verified sender domain; the shipped / refunded / cancelled
   events are ready to hook in.
2. Activity-log viewer (`auditLogs`).
3. Admin dashboard.
4. Customer accounts (CPF required at sign-up).
5. Coupons.
6. Melhor Envio.

`/admin/users` was dropped on 2026-11-03: single admin account.

**Needed before launch but not on this list:**
- `/admin/inventory`: stock adjustments.
- Terms/privacy pages: Prismic content the owner must publish (checkout links to them). Urgent since 2026-11-04:
  checkout is open and these pages still 404.

**Known issues:**
- Production (2026-11-04, early morning): checkout is open while `/terms`, `/privacy`, `/returns`, `/shipping`,
  `/cookies`, `/about` and `/faq` answer 404 (Prismic pages not published).
- Production (2026-11-04, "Found"): a page loaded during a deploy loses its files; since `6a5d29a` (deployed) a
  reload fixes it. The 404 page's missing security headers were fixed and deployed the same day (`58d92bd`).
- The custom domain `https://lojaiyanifa.com.br` goes through Cloudflare (Browser Cache TTL "Respect Existing
  Headers" since 2026-11-04, "Found later"). Check it after every deploy, not just `web.app`.
  `/robots.txt`, `/favicon.ico` and `/healthz` (session 5, "Found") were fixed and deployed on the evening of
  2026-11-03. Uptime checks should probe `/health`.
- `npm run preview`'s admin sign-in still fails on the CSP (`connect-src` doesn't allow the Auth emulator).
  `docs/security.md`, "Known gaps".
