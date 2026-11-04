import type { RouteConfigEntry } from "@react-router/dev/routes";
import { matchRoutes, type RouteObject } from "react-router";
import { describe, expect, it } from "vitest";

import routes from "~/routes";
import NotFound, { action, loader } from "~/routes/not-found";

/** The app's route config as React Router route objects, each carrying its file in `handle`. */
const toRouteObjects = (entries: RouteConfigEntry[]): RouteObject[] =>
  entries.map((entry) =>
    entry.index
      ? { index: true, handle: { file: entry.file } }
      : { path: entry.path, handle: { file: entry.file }, children: entry.children && toRouteObjects(entry.children) },
  );
const fileFor = (path: string): string | undefined => matchRoutes(toRouteObjects(routes), path)?.at(-1)?.route.handle.file;

describe("a path no other route takes", () => {
  it("goes to the catch-all, and every known path still goes to its own route", () => {
    for (const path of ["/nao-existe", "/admin/nao-existe", "/products", "/products/alaka/extra", "/a/b/c", "/wp-login.php"]) {
      expect(fileFor(path), path).toBe("routes/not-found.tsx");
    }
    expect(fileFor("/")).toBe("routes/home.tsx");
    expect(fileFor("/products/alaka")).toBe("routes/product.tsx");
    expect(fileFor("/about")).toBe("routes/page.tsx");
    expect(fileFor("/admin")).toBe("routes/admin.home.ts");
    expect(fileFor("/admin/orders")).toBe("routes/admin.orders.tsx");
    expect(fileFor("/admin/login")).toBe("routes/admin.login.tsx");
    expect(fileFor("/assets/root-AbC123.css")).toBe("routes/missing-asset.ts");
    expect(fileFor("/health")).toBe("routes/health.ts");
    expect(fileFor("/sitemap.xml")).toBe("routes/sitemap-xml.ts");
  });

  it("is a 404 for every method (a POST too, not a 405)", () => {
    for (const handler of [loader, action]) {
      let thrown: unknown;
      try {
        handler();
      } catch (error) {
        thrown = error;
      }
      expect(thrown, handler.name).toMatchObject({ data: "Página não encontrada", init: { status: 404 } });
    }
  });

  it("keeps its component: without one it would be a resource route, and the 404 would go out without the page", () => {
    expect(typeof NotFound).toBe("function");
  });
});
