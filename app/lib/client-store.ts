// Browser-side state that must work for guests: cart, wishlist, recently viewed.
// Stored in localStorage (Firebase Hosting forwards no cookie except __session,
// so a cart cookie would never reach the server anyway). Prices are NOT stored
// here: the server re-prices every line from Prismic (see /api/cart/quote).
//
// SSR-safe: the server snapshot is always empty, and components hydrate to the
// real values on the client.
import { useSyncExternalStore } from "react";

import { MAX_CART_LINES, MAX_LINE_QUANTITY } from "~/lib/cart/limits";

export { MAX_LINE_QUANTITY };

export interface CartItem {
  productId: string;
  sku: string;
  quantity: number;
}

const MAX_RECENT = 12;

const KEYS = {
  cart: "li.cart.v1",
  wishlist: "li.wishlist.v1",
  recent: "li.recent.v1",
} as const;
type StoreKey = keyof typeof KEYS;

const EMPTY_CART: CartItem[] = [];
const EMPTY_IDS: string[] = [];

const snapshots = new Map<StoreKey, unknown>();
const listeners = new Set<() => void>();

function isCartItem(value: unknown): value is CartItem {
  const v = value as CartItem;
  return (
    typeof v === "object" && v !== null &&
    typeof v.productId === "string" && typeof v.sku === "string" &&
    Number.isInteger(v.quantity) && v.quantity > 0 && v.quantity <= MAX_LINE_QUANTITY
  );
}

function parse(key: StoreKey, raw: string | null): unknown {
  if (!raw) return key === "cart" ? EMPTY_CART : EMPTY_IDS;
  try {
    const value: unknown = JSON.parse(raw);
    if (!Array.isArray(value)) throw new Error("not an array");
    // Drop malformed entries (e.g. written by an older version) instead of crashing the page.
    return key === "cart" ? value.filter(isCartItem) : value.filter((v): v is string => typeof v === "string");
  } catch (error) {
    console.warn(`[client-store] discarding unreadable ${KEYS[key]}`, error);
    return key === "cart" ? EMPTY_CART : EMPTY_IDS;
  }
}

function read<T>(key: StoreKey): T {
  if (!snapshots.has(key)) {
    let raw: string | null = null;
    try {
      raw = window.localStorage.getItem(KEYS[key]);
    } catch {
      // Storage blocked (private mode / disabled): behave as empty, writes will no-op.
    }
    snapshots.set(key, parse(key, raw));
  }
  return snapshots.get(key) as T;
}

function write(key: StoreKey, value: unknown) {
  snapshots.set(key, value);
  try {
    window.localStorage.setItem(KEYS[key], JSON.stringify(value));
  } catch (error) {
    console.warn(`[client-store] could not persist ${KEYS[key]}`, error);
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    const key = (Object.keys(KEYS) as StoreKey[]).find((k) => KEYS[k] === event.key);
    if (!key) return;
    snapshots.set(key, parse(key, event.newValue)); // another tab changed it
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function useStore<T>(key: StoreKey, serverValue: T): T {
  return useSyncExternalStore(subscribe, () => read<T>(key), () => serverValue);
}

// --- cart ---------------------------------------------------------------------
export const useCart = () => useStore<CartItem[]>("cart", EMPTY_CART);
export const useCartCount = () => useCart().reduce((sum, item) => sum + item.quantity, 0);

export const cart = {
  items: () => read<CartItem[]>("cart"),
  /** Adds units of a SKU. Returns false, changing nothing, when a new line would exceed MAX_CART_LINES. */
  add(item: CartItem): boolean {
    const items = read<CartItem[]>("cart");
    const existing = items.find((i) => i.sku === item.sku);
    if (!existing && items.length >= MAX_CART_LINES) return false;
    const next = existing
      ? items.map((i) => (i.sku === item.sku ? { ...i, quantity: Math.min(MAX_LINE_QUANTITY, i.quantity + item.quantity) } : i))
      : [...items, { ...item, quantity: Math.min(MAX_LINE_QUANTITY, item.quantity) }];
    write("cart", next);
    return true;
  },
  setQuantity(sku: string, quantity: number) {
    const q = Math.floor(quantity);
    const items = read<CartItem[]>("cart");
    write("cart", q <= 0 ? items.filter((i) => i.sku !== sku) : items.map((i) => (i.sku === sku ? { ...i, quantity: Math.min(MAX_LINE_QUANTITY, q) } : i)));
  },
  /** Swap a line to another variant of the same product, merging if that variant is already in the cart. */
  changeVariant(fromSku: string, toSku: string) {
    if (fromSku === toSku) return;
    const items = read<CartItem[]>("cart");
    const from = items.find((i) => i.sku === fromSku);
    if (!from) return;
    const rest = items.filter((i) => i.sku !== fromSku);
    const target = rest.find((i) => i.sku === toSku);
    write(
      "cart",
      target
        ? rest.map((i) => (i.sku === toSku ? { ...i, quantity: Math.min(MAX_LINE_QUANTITY, i.quantity + from.quantity) } : i))
        : [...rest, { ...from, sku: toSku }],
    );
  },
  remove(sku: string) {
    write("cart", read<CartItem[]>("cart").filter((i) => i.sku !== sku));
  },
  replace(items: CartItem[]) {
    write("cart", items.filter(isCartItem));
  },
  clear() {
    write("cart", EMPTY_CART);
  },
};

// --- wishlist -----------------------------------------------------------------
export const useWishlist = () => useStore<string[]>("wishlist", EMPTY_IDS);

export const wishlist = {
  toggle(productId: string) {
    const ids = read<string[]>("wishlist");
    write("wishlist", ids.includes(productId) ? ids.filter((id) => id !== productId) : [productId, ...ids]);
  },
  replace(ids: string[]) {
    write("wishlist", [...new Set(ids)]);
  },
};

// --- recently viewed ------------------------------------------------------------
export const useRecentlyViewed = () => useStore<string[]>("recent", EMPTY_IDS);

export const recentlyViewed = {
  push(productId: string) {
    const ids = read<string[]>("recent").filter((id) => id !== productId);
    write("recent", [productId, ...ids].slice(0, MAX_RECENT));
  },
};
