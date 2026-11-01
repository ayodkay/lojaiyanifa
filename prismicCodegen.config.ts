import type { Config } from "prismic-ts-codegen";

// Generates TypeScript types from the Prismic models versioned in customtypes/.
// Run `npm run prismic:types` after changing a model (and before pushing it).
const config: Config = {
  output: "./app/types/prismic.generated.ts",
  models: ["./customtypes/**/index.json"],
  clientIntegration: {
    includeCreateClientInterface: true,
    includeContentNamespace: true,
  },
};

export default config;
