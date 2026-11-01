import { existsSync } from "node:fs";
import { reactRouter } from "@react-router/dev/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

// Server code reads its configuration from process.env (validated in
// app/.server/env.ts). In local development, load .env.local into process.env
// so loaders/actions see the same variables Cloud Functions provides in
// production. Variables already set in the shell win.
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export default defineConfig({
  // Only variables starting with PUBLIC_ are exposed to browser code via
  // import.meta.env. Everything else stays server-side.
  envPrefix: "PUBLIC_",
  environments: {
    ssr: {
      build: {
        rollupOptions: {
          // The SSR bundle entry is our Cloud Functions module, which wraps
          // the React Router server build (virtual:react-router/server-build).
          input: "./server/app.ts",
        },
      },
    },
  },
  plugins: [tailwindcss(), reactRouter()],
  resolve: {
    tsconfigPaths: true,
  },
});
