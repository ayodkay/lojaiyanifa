import { Link } from "react-router";

import type { ProductSummary } from "~/lib/catalog/query";
import { useWishlist, wishlist } from "~/lib/client-store";

import { HeartIcon } from "./icons";
import { AvailabilityBadge, cx, Price, ProductImage } from "./ui";

export function ProductCard({ product, priority = false, sizes }: { product: ProductSummary; priority?: boolean; sizes?: string }) {
  const saved = useWishlist().includes(product.id);
  return (
    <article className="group relative">
      <Link to={`/products/${product.uid}`} className="block" prefetch="intent">
        <div className="relative overflow-hidden">
          <ProductImage
            image={product.image}
            name={product.name}
            priority={priority}
            sizes={sizes ?? "(min-width: 1280px) 300px, (min-width: 768px) 30vw, 50vw"}
            className="transition-transform duration-700 ease-[var(--ease-soft)] group-hover:scale-[1.03]"
          />
          {product.hoverImage && (
            <ProductImage
              image={product.hoverImage}
              name={product.name}
              sizes={sizes ?? "(min-width: 1280px) 300px, (min-width: 768px) 30vw, 50vw"}
              className="absolute inset-0 opacity-0 transition-opacity duration-500 group-hover:opacity-100"
            />
          )}
          <div className="absolute left-2 top-2 flex flex-col items-start gap-1">
            <AvailabilityBadge availability={product.availability} />
            {product.discountPercent !== null && (
              <span className="bg-sale px-2 py-0.5 text-[0.7rem] font-medium uppercase tracking-[0.12em] text-white">
                −{product.discountPercent}%
              </span>
            )}
          </div>
        </div>
        <h3 className="font-display mt-4 text-lg leading-snug text-ink">{product.name}</h3>
        <Price
          className="mt-1 text-sm"
          cents={product.priceCents}
          originalCents={product.originalPriceCents}
          discountPercent={product.discountPercent}
          from={product.priceFrom}
        />
      </Link>
      <button
        type="button"
        onClick={() => wishlist.toggle(product.id)}
        aria-pressed={saved}
        aria-label={saved ? `Remover ${product.name} da lista de desejos` : `Salvar ${product.name} na lista de desejos`}
        className={cx(
          "absolute right-2 top-2 grid h-9 w-9 place-items-center rounded-full bg-paper/90 text-ink shadow-sm transition-opacity",
          !saved && "opacity-100 md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
        )}
      >
        <HeartIcon filled={saved} width={18} height={18} />
      </button>
    </article>
  );
}

export function ProductGrid({ products, priorityCount = 0 }: { products: ProductSummary[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 md:gap-x-6 xl:grid-cols-4">
      {products.map((p, i) => (
        <li key={p.id}>
          <ProductCard product={p} priority={i < priorityCount} />
        </li>
      ))}
    </ul>
  );
}
