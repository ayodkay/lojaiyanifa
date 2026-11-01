import { useSyncExternalStore } from "react";

const subscribe = () => () => {};

/**
 * false on the server and during hydration, true afterwards. For UI that
 * depends on browser-only state (localStorage cart), so the server HTML never
 * claims e.g. "your cart is empty" before the browser has looked.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
