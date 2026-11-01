import type { ComponentProps, ReactNode } from "react";
import { Link } from "react-router";

import type { Availability, CatalogImage } from "~/lib/catalog/types";
import { imgixSrc, imgixSrcSet } from "~/lib/images";
import { type Cents, formatBRL } from "~/lib/money";

export function cx(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(" ");
}

const buttonBase =
  "inline-flex items-center justify-center gap-2 rounded-[var(--radius-control)] px-6 py-3 text-sm font-medium tracking-wide transition-colors duration-200 disabled:cursor-not-allowed disabled:opacity-50";
const buttonVariants = {
  primary: "bg-accent text-accent-contrast hover:bg-ink-soft",
  secondary: "border border-ink text-ink hover:bg-ink hover:text-paper",
  ghost: "text-ink underline-offset-4 hover:underline px-0 py-0",
} as const;
type Variant = keyof typeof buttonVariants;

export function Button({ variant = "primary", className, ...props }: ComponentProps<"button"> & { variant?: Variant }) {
  return <button type="button" className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function ButtonLink({ variant = "primary", className, ...props }: ComponentProps<typeof Link> & { variant?: Variant }) {
  return <Link className={cx(buttonBase, buttonVariants[variant], className)} {...props} />;
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}

export function Price({
  cents,
  originalCents,
  discountPercent,
  from = false,
  className,
}: {
  cents: Cents | null;
  originalCents?: Cents | null;
  discountPercent?: number | null;
  from?: boolean;
  className?: string;
}) {
  if (cents === null) return <span className={cx("text-muted", className)}>Preço indisponível</span>;
  const discounted = originalCents !== null && originalCents !== undefined && discountPercent;
  return (
    <span className={cx("inline-flex flex-wrap items-baseline gap-x-2", className)}>
      {from && <span className="text-sm text-muted">a partir de</span>}
      {discounted && <VisuallyHidden>Preço atual:</VisuallyHidden>}
      <span className="font-medium text-ink">{formatBRL(cents)}</span>
      {discounted && (
        <>
          <VisuallyHidden>Preço original:</VisuallyHidden>
          <s className="text-sm text-muted">{formatBRL(originalCents)}</s>
          <span className="text-sm font-medium text-sale">−{discountPercent}%</span>
        </>
      )}
    </span>
  );
}

const AVAILABILITY_LABEL: Record<Availability, string | null> = {
  in_stock: null,
  out_of_stock: "Esgotado",
  preorder: "Pré-venda",
  backorder: "Sob encomenda",
  discontinued: "Indisponível",
};

export function AvailabilityBadge({ availability, className }: { availability: Availability; className?: string }) {
  const label = AVAILABILITY_LABEL[availability];
  if (!label) return null;
  return (
    <span className={cx("inline-block bg-paper px-2 py-0.5 text-[0.7rem] uppercase tracking-[0.12em] text-ink-soft", className)}>
      {label}
    </span>
  );
}

/**
 * Responsive product image (imgix srcset). Without an image, a neutral
 * placeholder holds the layout; it is decorative because the product name is
 * always rendered next to it.
 */
export function ProductImage({
  image,
  name,
  sizes,
  aspect = "4 / 5",
  priority = false,
  className,
}: {
  image: CatalogImage | null;
  name: string;
  sizes: string;
  aspect?: string;
  priority?: boolean;
  className?: string;
}) {
  const ar = aspect.replace(/\s/g, "").replace("/", ":");
  if (!image) {
    return (
      <div aria-hidden="true" style={{ aspectRatio: aspect }} className={cx("relative grid place-items-center overflow-hidden bg-paper-deep", className)}>
        <svg viewBox="0 0 100 100" className="absolute inset-0 h-full w-full text-line" preserveAspectRatio="xMidYMid slice">
          <circle cx="50" cy="50" r="34" fill="none" stroke="currentColor" strokeWidth="0.6" />
          <circle cx="50" cy="50" r="26" fill="none" stroke="currentColor" strokeWidth="0.4" />
        </svg>
        <span className="font-display relative text-4xl text-muted">{name.trim().charAt(0).toUpperCase()}</span>
      </div>
    );
  }
  return (
    <img
      src={imgixSrc(image.url, { w: 640, ar, fit: "crop" })}
      srcSet={imgixSrcSet(image.url, [320, 480, 640, 960, 1280], { ar, fit: "crop" })}
      sizes={sizes}
      alt={image.alt}
      width={640}
      height={Math.round((640 * Number(ar.split(":")[1])) / Number(ar.split(":")[0]))}
      loading={priority ? "eager" : "lazy"}
      decoding="async"
      fetchPriority={priority ? "high" : undefined}
      style={{ aspectRatio: aspect }}
      className={cx("h-auto w-full bg-paper-deep object-cover", className)}
    />
  );
}

export function Breadcrumbs({ items }: { items: { name: string; href: string }[] }) {
  return (
    <nav aria-label="Trilha de navegação" className="text-sm text-muted">
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-1">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={item.href} className="flex items-center gap-2">
              {last ? (
                <span aria-current="page" className="text-ink">
                  {item.name}
                </span>
              ) : (
                <>
                  <Link to={item.href} className="hover:text-ink hover:underline">
                    {item.name}
                  </Link>
                  <span aria-hidden="true">/</span>
                </>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function SectionHeading({ eyebrow, title, action, id }: { eyebrow?: string; title: string; action?: ReactNode; id?: string }) {
  return (
    <div className="mb-8 flex items-end justify-between gap-6 border-b border-line pb-4">
      <div>
        {eyebrow && <p className="eyebrow mb-2">{eyebrow}</p>}
        <h2 id={id} className="text-3xl md:text-4xl">
          {title}
        </h2>
      </div>
      {action}
    </div>
  );
}

export function Notice({ tone = "info", children }: { tone?: "info" | "success" | "warning" | "danger"; children: ReactNode }) {
  const tones = {
    info: "border-line bg-surface text-ink-soft",
    success: "border-success/40 bg-surface text-success",
    warning: "border-warning/40 bg-surface text-warning",
    danger: "border-danger/40 bg-surface text-danger",
  };
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={cx("border px-4 py-3 text-sm", tones[tone])}>
      {children}
    </div>
  );
}
