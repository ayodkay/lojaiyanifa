# Security notes

Living document: known risks, accepted exceptions and how each control is implemented.
Controls are filled in as features land; see the checklist in
`ecommerce_master_build_prompt.md` §17 for status.

## Dependency audit exceptions

| Date | Advisory | Path | Decision |
| --- | --- | --- | --- |
| 2026-10-31 | GHSA-m9gg-hp2v-232j, GHSA-f596-whhp-79r4 (`@grpc/grpc-js` < 1.13.6, high/low) | `firebase` (browser SDK) → `@firebase/firestore` pins `~1.9.0` | **Fixed** with an npm `overrides` entry forcing `^1.14.7` for that one consumer. Both advisories concern gRPC *servers*; the browser SDK never runs one, and the app doesn't use client-side Firestore at all. |
| 2026-10-31 | 6 × moderate: `glob`/`minimatch` (DoS via glob patterns, AbortSignal bypass) | `firebase-admin` → `gaxios` / `google-gax` → `rimraf` → `glob` → `minimatch` | **Deferred (owner decision).** `npm audit fix` cannot apply the patched versions within the ranges those Google libraries declare, and forcing a new major could break `firebase-admin` at runtime. Not reachable from the store: no request input is ever used as a glob pattern. Re-check whenever `firebase-admin` is updated. CI fails on high/critical only. |

## Secrets

- Never commit secrets. `.env.local` (development) is gitignored; `.env.example`
  documents every variable without values.
- Production secrets live in Cloud Secret Manager (`firebase functions:secrets:set NAME`).
- Production configuration (not secret) lives in the gitignored `.env.lojaiyanifa`. It reaches the deployed functions
  only through the predeploy hook `scripts/functions-env.mjs`. Unit-tested and mutation-checked 2026-11-03; it refuses:
  - emulator variables;
  - `FUNCTIONS_EMULATOR`, which would switch off the emulator-in-production guard;
  - `GOOGLE_APPLICATION_CREDENTIALS`;
  - tokens;
  - `ADMIN_REQUIRE_MFA` other than `true`;
  - a `SITE_URL` that isn't an https origin.
- Google credentials for the admin scripts (`--production`): gcloud ADC, or a service-account key kept out of git
  (`*-firebase-adminsdk-*.json` and `service-account*.json` are ignored) and passed through the shell's
  `GOOGLE_APPLICATION_CREDENTIALS`. Such a key never expires: keep it outside the project folder and delete it in the
  console (IAM → Service accounts → Keys) when it's no longer needed.
- 2026-10-31: the Prismic write token and Content API token were removed from
  the original scripts (they had been hardcoded) and moved to `.env.local` before
  the first commit. Rotate them in Prismic (Settings → API & Security) if they were
  ever shared outside this machine.

## Admin access (built 2026-11-02)

Design: docs/architecture.md §3. How each control is implemented and tested:

| Control | Where | Tested by |
| --- | --- | --- |
| Session cookie `__session`: HttpOnly, Secure, SameSite=Lax, Path=/, 12 h | `app/.server/session.ts` | unit (exact header), Chrome (not readable by page JS) |
| Session minted only from a sign-in < 5 min old | `createAdminSession` | integration (stale sign-in refused) |
| Revocation checked on every admin request and at sign-in | `readAdminSession`, `createAdminSession` | unit with a stubbed Auth (the emulator always checks, so it can't catch a missing flag); integration (revoked → signed out) |
| Role claim required; verified e-mail required | `adminRefusal` | unit + integration + Chrome (customer account refused) |
| Second factor required when `ADMIN_REQUIRE_MFA=true` | `adminRefusal` | integration with a real emulator SMS factor (claim survives into the cookie) |
| Gate runs before every admin loader/action | middleware in `app/routes/admin.tsx` → `app/.server/admin-guard.ts` | Chrome + curl (signed out → 302 to login) |
| Capability per action (staff can't cancel) | `requireCapability` | unit (role table) + Chrome (crafted POST → 403) |
| Sign-out ends every session of the account | `endAdminSession` (POST only) | integration (two "devices") + Chrome (emulator `validSince` moved) |
| Role changes take effect at once | `scripts/admin/roles.mjs` revokes after changing claims | integration (live cookie keeps old claims until revoked) |
| Open redirect after sign-in | `safeAdminRedirect` (same-origin `/admin/*` only) | unit |
| Password never in a URL if submitted before hydration | login form: `method="post"`, password input has no `name` | rendered HTML check |
| Production can't run in emulator (unsigned-token) mode | `assertNoEmulatorInProduction` in `app/.server/firebase.ts` | unit |
| Audit trail | `auditLogs` (order changes and their entry in one transaction) | integration + emulator check after Chrome run |
| Security headers (CSP, `nosniff`, `X-Frame-Options`, HSTS, …) on every page, unknown paths included: they match a catch-all route, so the root middleware runs (built and deployed 2026-11-04; before, a path no route matched got none of them) | `app/.server/security.ts`, `app/routes/not-found.tsx` | unit (routing; a 404 for every method) + the production build in the emulators + live, both hosts |
| Admin pages never cached or indexed | `Cache-Control: private, no-store` + `X-Robots-Tag` set by the admin middleware; `noindex` meta | curl |
| Second factor: TOTP code after the password; enrolment before first use (built 2026-11-02) | `app/.client/firebase.ts`, `app/routes/admin.login.tsx` | Chrome with `ADMIN_REQUIRE_MFA=true` (enrolment screen, emulator error mapped, SMS-only account refused); the code exchange itself on the real project: the owner's first sign-in, enrolment then a code, worked on 2026-11-04 |
| TOTP secret never reaches our server; QR drawn in the browser (data: image, allowed by the CSP) | `startTotpEnrollment` + lazy `qrcode` import | code review; the server bundle has no browser SDK (build check) |
| Lost authenticator: factors removed only by an operator script, sessions revoked, audited | `scripts/admin/reset-mfa.mjs` (`mfa.reset`) | 8 CLI cases against the emulator |
| Order changes re-check state in one transaction; a lost race is a 409, never a double settlement | `settlePendingOrder`, `takeFulfillmentStep`, `recordRefund` | integration (races + stubbed "transaction closed" errors) |
| Refunds: owner/admin only; amount ≤ what remains; units ≤ what the order took; one refund per form key | `requireCapability("orders.refund")`, `parseRefundForm`, `refundInTransaction` | unit + integration + Chrome |
| Tracking links shown to customers: https only, `rel="noopener noreferrer"` | `parseTracking` | unit (javascript:/data:/http refused) + Chrome |
| Settings: the owner edits, an admin reads, staff have no access (built 2026-11-03) | `settings.view` / `settings.edit`, checked in the loader and on every action of `app/routes/admin.settings.tsx` | unit (role table) + Chrome (staff: no link, 403; staff and admin crafted POSTs 403; admin read-only) |
| Settings saves: one transaction, refused when the page is stale (409), nothing written when nothing changed, audit entry with the Pix key masked (type + last 4); checkout opens only by the owner's switch and only with valid settings | `app/.server/admin-settings.ts`, `app/.server/settings-forms.ts` | 9 unit + 6 integration, 8 of 8 mutations caught, Chrome on a separate dev stack |

## Customer accounts (built 2026-11-04)

| Control | Where | Tested by |
| --- | --- | --- |
| Session cookie `__session`: HttpOnly, Secure, SameSite=Lax, 14 days, minted only from a sign-in < 5 min old, revocation checked on every request | `app/.server/customer-session.ts`, `app/.server/account-guard.ts` | integration (exact header, stale sign-in, forged token, revocation) + HTTP check on the dev stack |
| Passwords never sent to our server (inputs without `name`; Firebase SDK in memory only) | `/register`, `/login`, `/account/security`, `/account/privacy` | rendered HTML; Chrome |
| Guest orders visible to an account only after e-mail verification | `ownsOrder` (`app/.server/customers.ts`) | integration (unverified sees only its own; verified sees guest orders with its e-mail; never another's) |
| Another customer's order → 404 (indistinguishable from a missing one) | `getCustomerOrder` | integration |
| Account deletion needs the password typed again (fresh token of the same UID) | `verifyRecentSignIn` | integration + Chrome |
| LGPD requests audited with the UID only (`customer.data_exported`, `customer.account_deleted`) | `app/.server/customers.ts` | integration (no e-mail in the entry) + emulator check |
| No account enumeration on password reset (same message for unknown e-mails) | `/forgot-password` | Chrome (unknown and existing e-mail; reset e-mail generated only for the existing one) |
| Redirect after sign-in: same-site paths only, never `/admin` | `safeAccountRedirect` | unit |
| Order e-mail links use a separate random token; both order secrets compared in constant time | `orderTokenMatches` | unit + integration |
| Contact form abuse: honeypot field, fill time ≥ 3 s measured in the browser, hourly limits (5/IP, 5/e-mail, 60 in all); the IP is stored only as sha256(ip + hour); a refused message writes nothing | `app/lib/support.ts` (`botReason`), `app/.server/support.ts` (`createTicket`) | unit + integration + Chrome (instant submit refused) |
| Ticket contents escaped in e-mails; the team's replies are plain text | `app/.server/mail/render.ts` | unit |
| Tickets: another customer's ticket → 404; guest tickets join an account only with a verified e-mail | `ownsTicket` | integration |

## Known gaps (updated 2026-11-04)

- **CSP on admin pages** still allows inline scripts (`'unsafe-inline'`, needed on
  CDN-cached public pages for React Router's hydration scripts). Admin/account
  pages are never cached, so they could use a per-request nonce instead — not done.
- **`npm run preview`** (production build in the functions emulator): the CSP's
  `connect-src` doesn't allow the Auth emulator, so admin sign-in fails there. (The other preview
  problem, a `build/functions/.env.local` the Firebase CLI refused, so no function loaded, was fixed
  2026-11-03: the build leaves the refused `FIREBASE_*` names out.)
- **Rate limiting on `/admin/login`**: only Firebase Auth's own throttling
  (`auth/too-many-requests`); Cloudflare rules are still to be written.
- **Contact form limits use the first `x-forwarded-for` entry**, which a client talking to `lojaiyanifa.web.app`
  directly can forge; the e-mail and store-wide limits still apply. Cloudflare Turnstile (keys from the owner's
  Cloudflare account; the CSP already allows `challenges.cloudflare.com`) is the planned real protection.
- **Firestore composite indexes** (`orders`: status + number, status + expiresAt): deployed 2026-11-03
  and both READY (`firebase firestore:indexes --pretty`). The emulator doesn't enforce indexes, so the
  admin orders tabs still need a look once the owner can sign in.
