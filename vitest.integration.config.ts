import { defineConfig } from "vitest/config";

// Integration tests run against the Firebase emulators (Java 21+ required).
// Run them with `npm run test:integration`, which wraps vitest in
// `firebase emulators:exec` — that starts Firestore + Auth and sets
// FIRESTORE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST for the test process.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    // One emulator is shared by every file: run files one at a time, and each
    // test starts from an empty database (see tests/integration/emulators.ts).
    fileParallelism: false,
    testTimeout: 20_000,
    env: {
      FIREBASE_PROJECT_ID: "demo-lojaiyanifa",
      SITE_URL: "http://localhost:5173",
      PRISMIC_REPO: "lojaiyanifa",
    },
  },
});
