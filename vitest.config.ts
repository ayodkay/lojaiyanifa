import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: unit tests don't need (and shouldn't
// load) the React Router plugin or .env.local.
export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    environment: "node",
  },
});
