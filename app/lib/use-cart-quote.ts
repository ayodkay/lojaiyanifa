// Re-quotes the browser cart on the server whenever it changes (debounced),
// keeping the last good quote on screen while a new one loads. Quantities the
// server had to lower (stock) are written back to the stored cart and reported.
// Used by /cart and /checkout so both always show the same prices.
import { useEffect, useState } from "react";

import type { CartQuoteResponse } from "~/lib/cart/quote";
import { cart, type CartItem } from "~/lib/client-store";

export interface Adjustment {
  sku: string;
  name: string;
  from: number;
  to: number;
}

interface QuoteResult {
  key: string;
  data: CartQuoteResponse | null;
  failed: boolean;
}

/**
 * Re-quotes the cart (debounced) whenever it changes. The last good quote stays
 * on screen while a new one loads. Quantities the server had to lower (stock)
 * are applied to the stored cart and reported through `adjustments`.
 */
export function useCartQuote(items: CartItem[], enabled: boolean) {
  const [attempt, setAttempt] = useState(0);
  const [result, setResult] = useState<QuoteResult | null>(null);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const body = JSON.stringify({ items });
  const key = `${attempt}:${body}`;
  const empty = items.length === 0;

  useEffect(() => {
    if (!enabled || empty) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      fetch("/api/cart/quote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal,
      })
        .then(async (res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
          return (await res.json()) as CartQuoteResponse;
        })
        .then((data) => {
          setResult({ key, data, failed: false });
          const reduced = data.quote.lines.filter((l) => l.problem === "quantity_reduced" && l.quantity > 0);
          if (reduced.length > 0) {
            setAdjustments((prev) => [
              ...prev.filter((a) => !reduced.some((l) => l.sku === a.sku)),
              ...reduced.map((l) => ({ sku: l.sku, name: l.name, from: l.requestedQuantity, to: l.quantity })),
            ]);
            for (const l of reduced) cart.setQuantity(l.sku, l.quantity);
          }
        })
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          console.error("[cart] quote failed", error);
          setResult((prev) => ({ key, data: prev?.data ?? null, failed: true }));
        });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [enabled, empty, body, key]);

  return {
    data: result?.data ?? null,
    pending: enabled && !empty && result?.key !== key,
    failed: result?.key === key && result.failed,
    adjustments,
    dismissAdjustments: () => setAdjustments([]),
    retry: () => setAttempt((n) => n + 1),
  };
}
