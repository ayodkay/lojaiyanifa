// Coupon box and discount rows for the cart and checkout summaries. The discount shown is the server's preview
// (/api/cart/quote, app/lib/discounts.ts); the order decides when it is placed.
import { type FormEvent, useState } from "react";

import { coupon } from "~/lib/client-store";
import type { DiscountResult } from "~/lib/discounts";
import { normalizeCouponCode } from "~/lib/discounts";
import { formatBRL } from "~/lib/money";

import { Button, cx } from "./ui";

/** Rows for a summary's <dl>: one per discount; free shipping says so instead of an amount. */
export function DiscountRows({ discount }: { discount: DiscountResult }) {
  return (
    <>
      {discount.applied.map((d) => (
        <div key={d.promotionId} className="flex justify-between gap-4 text-sale">
          <dt>
            {d.label}
            {d.code && <span className="text-muted"> ({d.code})</span>}
          </dt>
          <dd className="shrink-0 whitespace-nowrap">{d.freeShipping ? "Frete grátis" : `− ${formatBRL(d.amountCents)}`}</dd>
        </div>
      ))}
    </>
  );
}

/** What the customer is told about the coupon they typed. */
function couponMessage(code: string, discount: DiscountResult | null): { tone: "ok" | "info" | "error"; text: string } | null {
  const status = discount?.coupon;
  if (!status) return null;
  switch (status.state) {
    case "applied": {
      const provisional = discount.applied.some((a) => a.code === code && a.provisional);
      return { tone: "ok", text: provisional ? `Cupom ${code} aplicado. As condições dele são confirmadas ao finalizar a compra.` : `Cupom ${code} aplicado.` };
    }
    case "not_best":
      return { tone: "info", text: `O cupom ${code} não foi usado: a promoção “${status.beatenBy}” já dá um desconto maior.` };
    case "refused":
    case "unknown":
      return { tone: "error", text: status.message };
  }
}

/** The coupon in use and what happened to it, with a way to remove it. No <form>: usable inside the checkout form. */
export function CouponStatus({ current, discount }: { current: string; discount: DiscountResult | null }) {
  const message = couponMessage(current, discount);
  return (
    <div className="space-y-2 text-sm">
      <div className="flex items-center justify-between gap-3">
        <span>
          Cupom: <strong className="font-mono">{current}</strong>
        </span>
        <button type="button" className="underline underline-offset-4" onClick={() => coupon.set(null)}>
          Remover
        </button>
      </div>
      {message && (
        <p role="status" className={cx(message.tone === "error" ? "text-danger" : message.tone === "ok" ? "text-success" : "text-muted")}>
          {message.text}
        </p>
      )}
    </div>
  );
}

export function CouponBox({ current, discount }: { current: string | null; discount: DiscountResult | null }) {
  const [typed, setTyped] = useState("");
  const [error, setError] = useState<string | null>(null);

  const apply = (event: FormEvent) => {
    event.preventDefault();
    const code = normalizeCouponCode(typed);
    if (!code) return setError("Código inválido: use letras, números ou hífen, sem espaços.");
    setError(null);
    setTyped("");
    coupon.set(code);
  };

  if (current) return <CouponStatus current={current} discount={discount} />;
  return (
    <form onSubmit={apply} noValidate className="space-y-2 text-sm">
      <label htmlFor="f-coupon" className="block">
        Cupom de desconto
      </label>
      <div className="flex gap-2">
        <input
          id="f-coupon"
          value={typed}
          onChange={(e) => setTyped(e.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? "f-coupon-erro" : undefined}
          className="min-h-11 w-full min-w-0 rounded-[var(--radius-control)] border border-line-strong bg-paper px-3 uppercase"
        />
        <Button type="submit" variant="secondary" className="shrink-0 px-4">
          Aplicar
        </Button>
      </div>
      {error && (
        <p id="f-coupon-erro" className="text-danger">
          {error}
        </p>
      )}
    </form>
  );
}
