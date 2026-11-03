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
| Admin pages never cached or indexed | `Cache-Control: private, no-store` + `X-Robots-Tag` set by the admin middleware; `noindex` meta | curl |
| Second factor: TOTP code after the password; enrolment before first use (built 2026-11-02) | `app/.client/firebase.ts`, `app/routes/admin.login.tsx` | Chrome with `ADMIN_REQUIRE_MFA=true` (enrolment screen, emulator error mapped, SMS-only account refused); the code exchange itself only on the real project (pending first deploy) |
| TOTP secret never reaches our server; QR drawn in the browser (data: image, allowed by the CSP) | `startTotpEnrollment` + lazy `qrcode` import | code review; the server bundle has no browser SDK (build check) |
| Lost authenticator: factors removed only by an operator script, sessions revoked, audited | `scripts/admin/reset-mfa.mjs` (`mfa.reset`) | 8 CLI cases against the emulator |
| Order changes re-check state in one transaction; a lost race is a 409, never a double settlement | `settlePendingOrder`, `takeFulfillmentStep`, `recordRefund` | integration (races + stubbed "transaction closed" errors) |
| Refunds: owner/admin only; amount ≤ what remains; units ≤ what the order took; one refund per form key | `requireCapability("orders.refund")`, `parseRefundForm`, `refundInTransaction` | unit + integration + Chrome |
| Tracking links shown to customers: https only, `rel="noopener noreferrer"` | `parseTracking` | unit (javascript:/data:/http refused) + Chrome |

## Known gaps (2026-11-02)

- **TOTP unverified on the real project**: built and checked against the emulator, which
  has no TOTP. Production admin sign-in works only once the first deploy confirms it.
- **CSP on admin pages** still allows inline scripts (`'unsafe-inline'`, needed on
  CDN-cached public pages for React Router's hydration scripts). Admin/account
  pages are never cached, so they could use a per-request nonce instead — not done.
- **`npm run preview`** (production build in the functions emulator): the CSP's
  `connect-src` doesn't allow the Auth emulator, so admin sign-in fails there.
- **Rate limiting on `/admin/login`**: only Firebase Auth's own throttling
  (`auth/too-many-requests`); Cloudflare rules are still to be written.
- **Firestore composite index** `orders (status ASC, number DESC)` is declared in
  `firestore.indexes.json` but unverified: the emulator doesn't enforce indexes.
  Check the admin orders tabs right after the first deploy.
