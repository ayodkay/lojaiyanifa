import type { RouteConfigEntry } from "@react-router/dev/routes";
import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "~/routes";
import { loader } from "~/routes/missing-asset";

/** The app's route config as React Router route objects, each carrying its file in `handle`. */
const toRouteObjects = (entries: RouteConfigEntry[]): RouteObject[] =>
  entries.map((entry) =>
    entry.index
      ? { index: true, handle: { file: entry.file } }
      : { path: entry.path, handle: { file: entry.file }, children: entry.children && toRouteObjects(entry.children) },
  );
const fileFor = (path: string): string | undefined => matchRoutes(toRouteObjects(routes), path)?.at(-1)?.route.handle.file;

describe("a file under /assets/ that Hosting doesn't have", () => {
  it("gets a short 404 that neither the browser nor the CDN keeps", async () => {
    const response = loader();
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(await response.text()).toBe("Not found\n");
  });

  it("is where every /assets/ path goes, and no other path", () => {
    for (const path of ["/assets/root-AbC123.css", "/assets/entry.client-AbC123.js", "/assets/sub/chunk-AbC123.js"]) {
      expect(fileFor(path), path).toBe("routes/missing-asset.ts");
    }
    expect(fileFor("/")).toBe("routes/home.tsx");
    expect(fileFor("/products/alaka")).toBe("routes/product.tsx");
    expect(fileFor("/admin/login")).toBe("routes/admin.login.tsx");
    expect(fileFor("/health")).toBe("routes/health.ts");
    expect(fileFor("/assetsx/a.css")).toBe("routes/not-found.tsx");
  });
});
