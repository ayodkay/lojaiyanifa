import { defineConfig } from "vitest/config";

import integration from "./vitest.integration.config";

// The live e-mail check (`npm run test:mail-live`): the integration setup (emulators, aliases, env), but only
// tests/mail-live/, which sends real e-mails through the SMTP settings in .env.local. The unit and integration
// configs never include that folder.
export default defineConfig({
  ...integration,
  // silent: false — Vitest 5 hides a passing test's console output here; the check must show what it sent.
  test: { ...integration.test, include: ["tests/mail-live/**/*.test.ts"], testTimeout: 120_000, silent: false },
});
