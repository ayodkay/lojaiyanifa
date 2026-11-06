// The content pages (routes/page.tsx: /about, /privacy, /terms, /cookies, /shipping, /returns, /warranty and
// /pages/:uid) when a visitor clicks a link to one. A click doesn't load a new document: React Router fetches the
// loader data from /shipping.data, and React Router 8 gives the loader that raw request (request.url ends in .data)
// together with `url`, the page's own URL (no .data suffix, no _routes param). The loader looked the page up by
// request.url, so every click on these links (footer, cookie notice) was a 404 and only a reload showed the page
// (2026-11-06). These tests call the loader with the arguments a click produces.
import { RouterContextProvider } from "react-router";
import { describe, expect, it, vi } from "vitest";

import { PAGE_PATHS } from "~/lib/catalog/links";
import type { ContentPage } from "~/lib/catalog/types";

vi.mock("~/.server/prismic", async () => {
  const { PAGE_PATHS } = await import("~/lib/catalog/links");
  const page = (uid: string): ContentPage => ({
    id: uid,
    uid,
    title: uid,
    body: [],
    lastUpdated: null,
    seo: { title: null, description: null, image: null },
  });
  const uids = [...Object.keys(PAGE_PATHS), "guia-de-tamanhos"];
  return { getContent: async () => ({ pages: new Map(uids.map((uid) => [uid, page(uid)])), settings: { storeName: "Loja" } }) };
});
vi.mock("~/.server/env", () => ({ env: () => ({ SITE_URL: "http://localhost" }) }));

const { loader } = await import("~/routes/page");

/** What React Router 8 passes a loader when a <Link> to `path` is clicked: a request for `${path}.data`, and `url`. */
const clickTo = (path: string, params: { uid?: string } = {}): Parameters<typeof loader>[0] => ({
  request: new Request(`http://localhost${path}.data`),
  url: new URL(`http://localhost${path}`),
  params,
  context: new RouterContextProvider(),
  pattern: "",
});

describe("a content page opened by a click on a link", () => {
  it("loads at each fixed path (the loader is called for /shipping.data)", async () => {
    for (const [uid, path] of Object.entries(PAGE_PATHS)) {
      await expect(loader(clickTo(path)), path).resolves.toMatchObject({ data: { page: { uid } } });
    }
  });

  it("loads under /pages/:uid instead of redirecting to its own address", async () => {
    await expect(loader(clickTo("/pages/guia-de-tamanhos", { uid: "guia-de-tamanhos" }))).resolves.toMatchObject({
      data: { page: { uid: "guia-de-tamanhos" } },
    });
  });

  it("still sends a fixed page's /pages/:uid address to its own path (one address per page)", async () => {
    const thrown = await loader(clickTo("/pages/privacy", { uid: "privacy" })).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(Response);
    expect((thrown as Response).status).toBe(301);
    expect((thrown as Response).headers.get("Location")).toBe("/privacy");
  });
});
