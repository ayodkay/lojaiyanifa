import type { Config } from "@react-router/dev/config";

export default {
  // Server-side rendering: pages are rendered by the `ssr` Cloud Function
  // (server/app.ts) behind Firebase Hosting. See docs/architecture.md.
  ssr: true,
} satisfies Config;
