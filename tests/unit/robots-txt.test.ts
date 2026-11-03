import { describe, expect, it } from "vitest";

import { robotsTxt } from "../../scripts/robots-txt.mjs";

describe("robotsTxt", () => {
  it("lets a production origin be crawled except the private areas, and points to its sitemap", () => {
    expect(robotsTxt("https://loja.example")).toBe(
      [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /account",
        "Disallow: /orders",
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /order-confirmation",
        "Disallow: /wishlist",
        "Disallow: /api/",
        "",
        "Sitemap: https://loja.example/sitemap.xml",
        "",
      ].join("\n"),
    );
  });

  it("reads SITE_URL as the server does: a trailing slash never doubles in the sitemap URL", () => {
    expect(robotsTxt("https://loja.example/")).toContain("\nSitemap: https://loja.example/sitemap.xml\n");
  });

  it("closes every other site to crawlers: local, staging, preview channels, plain http", () => {
    for (const site of [
      "http://localhost:5173",
      "https://loja-staging.web.app",
      "https://loja--preview-1a2b3c.web.app",
      "http://loja.example",
    ]) {
      expect(robotsTxt(site), site).toBe("User-agent: *\nDisallow: /\n");
    }
  });
});
