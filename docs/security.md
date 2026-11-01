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
