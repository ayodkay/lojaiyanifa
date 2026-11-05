// /wishlist — the products the visitor saved with the heart. The list lives in the browser (guests too); for a signed-in
// customer this page also merges it with the account's copy (/api/wishlist, three-way: app/lib/wishlist-sync.ts), so
// it follows them across devices. Rendered after hydration; never indexed.
import { useEffect, useRef, useState } from "react";
import { data, Link } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { ProductCard } from "~/components/product-card";
import { Breadcrumbs, ButtonLink, Notice } from "~/components/ui";
import type { ProductSummary } from "~/lib/catalog/query";
import { useWishlist, wishlist } from "~/lib/client-store";
import { noStore, NO_STORE } from "~/lib/http";
import { seoMeta } from "~/lib/seo";
import { useHydrated } from "~/lib/use-hydrated";
import { mergeWishlists } from "~/lib/wishlist-sync";

import type { Route } from "./+types/wishlist";

export async function loader() {
  const { settings } = await getContent();
  return data({ siteUrl: env().SITE_URL, storeName: settings.storeName }, { headers: NO_STORE });
}

export const headers = noStore;

export function meta({ loaderData }: Route.MetaArgs) {
  if (!loaderData) return [{ title: "Lista de desejos" }];
  return seoMeta({ siteUrl: loaderData.siteUrl, storeName: loaderData.storeName, path: "/wishlist", title: "Lista de desejos", noindex: true });
}

/** The list as it was at the last sync with the account, in this browser (see mergeWishlists). */
const BASE_KEY = "li.wishlist-base.v1";
function readBase(): string[] | null {
  try {
    const raw = window.localStorage.getItem(BASE_KEY);
    const value: unknown = raw ? JSON.parse(raw) : null;
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : null;
  } catch {
    return null;
  }
}
function writeBase(ids: string[]) {
  try {
    window.localStorage.setItem(BASE_KEY, JSON.stringify(ids));
  } catch (error) {
    console.warn("[wishlist] could not keep the sync point", error);
  }
}

async function saveRemote(ids: string[]): Promise<string[] | null> {
  const res = await fetch("/api/wishlist", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ productIds: ids }) });
  if (!res.ok) throw new Error(`PUT /api/wishlist → ${res.status}`);
  return ((await res.json()) as { productIds: string[] }).productIds;
}

type Sync = "idle" | "guest" | "synced" | "failed";

export default function Wishlist() {
  const hydrated = useHydrated();
  const ids = useWishlist();
  const [products, setProducts] = useState<ProductSummary[] | null>(null);
  const [sync, setSync] = useState<Sync>("idle");
  const synced = useRef(false);

  // Once per visit: merge with the account's copy, if signed in.
  useEffect(() => {
    if (!hydrated || synced.current) return;
    synced.current = true;
    void (async () => {
      try {
        const res = await fetch("/api/wishlist", { headers: { accept: "application/json" } });
        if (res.status === 401) return setSync("guest");
        if (!res.ok) throw new Error(`GET /api/wishlist → ${res.status}`);
        const remote = ((await res.json()) as { productIds: string[] }).productIds;
        const merged = mergeWishlists(wishlist.items(), remote, readBase());
        const stored = merged.join() === remote.join() ? remote : await saveRemote(merged);
        wishlist.replace(stored ?? merged);
        writeBase(stored ?? merged);
        setSync("synced");
      } catch (error) {
        console.warn("[wishlist] sync with the account failed", error);
        setSync("failed");
      }
    })();
  }, [hydrated]);

  // Removing on this page while signed in: tell the account too.
  const remove = (id: string) => {
    wishlist.toggle(id);
    if (sync !== "synced") return;
    const next = wishlist.items();
    saveRemote(next)
      .then(() => writeBase(next))
      .catch((error) => {
        console.warn("[wishlist] could not save the removal to the account", error);
        setSync("failed");
      });
  };

  // Product cards for the saved IDs (24 per request).
  const key = ids.join(",");
  useEffect(() => {
    if (!hydrated) return;
    if (ids.length === 0) return setProducts([]);
    let cancelled = false;
    const chunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 24) chunks.push(ids.slice(i, i + 24));
    Promise.all(chunks.map((c) => fetch(`/api/products?ids=${encodeURIComponent(c.join(","))}`).then((r) => r.json() as Promise<{ products: ProductSummary[] }>)))
      .then((pages) => {
        if (!cancelled) setProducts(pages.flatMap((p) => p.products));
      })
      .catch((error) => {
        console.warn("[wishlist] could not load the products", error);
        if (!cancelled) setProducts([]);
      });
    return () => {
      cancelled = true;
    };
    // `key` stands for `ids` (a new array on every change).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated, key]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <Breadcrumbs items={[{ name: "Início", href: "/" }, { name: "Lista de desejos", href: "/wishlist" }]} />
      <h1 className="mb-6 mt-8 text-4xl md:text-5xl">Lista de desejos</h1>
      {sync === "guest" && ids.length > 0 && (
        <p className="mb-6 text-sm text-muted">
          A lista fica salva neste navegador.{" "}
          <Link to="/login?redirectTo=%2Fwishlist" className="text-ink underline underline-offset-4">
            Entre na sua conta
          </Link>{" "}
          para levá-la para outros aparelhos.
        </p>
      )}
      {sync === "failed" && (
        <div className="mb-6">
          <Notice tone="warning">Não foi possível sincronizar a lista com a sua conta agora. Ela continua salva neste navegador.</Notice>
        </div>
      )}
      {!hydrated || products === null ? (
        <p role="status" className="text-muted">
          Carregando…
        </p>
      ) : ids.length === 0 ? (
        <div className="space-y-6">
          <p className="text-lg text-muted">Sua lista está vazia. Toque no coração de um produto para guardá-lo aqui.</p>
          <ButtonLink to="/collections/all">Explorar produtos</ButtonLink>
        </div>
      ) : (
        <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {products.map((p) => (
            <li key={p.id} className="space-y-2">
              <ProductCard product={p} />
              <button type="button" onClick={() => remove(p.id)} className="text-sm text-muted underline underline-offset-4 hover:text-ink">
                Remover da lista
              </button>
            </li>
          ))}
          {products.length < ids.length && (
            <li className="col-span-full text-sm text-muted">
              {ids.length - products.length} {ids.length - products.length === 1 ? "produto saiu" : "produtos saíram"} da loja e não aparece{ids.length - products.length === 1 ? "" : "m"} mais.
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
