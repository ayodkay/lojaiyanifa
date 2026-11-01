import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { MAX_CART_LINES } from "~/lib/cart/limits";
import type { CatalogImage, CatalogProduct, CatalogVariant, CatalogVideo, VariantOptions } from "~/lib/catalog/types";
import { cart, MAX_LINE_QUANTITY, useWishlist, wishlist } from "~/lib/client-store";
import { imgixSrc } from "~/lib/images";

import { CloseIcon, HeartIcon } from "./icons";
import { AvailabilityBadge, Button, cx, Price, ProductImage } from "./ui";

// --- Gallery with hover zoom and a full-screen zoom dialog -----------------------
export function Gallery({ images, name, activeImage }: { images: CatalogImage[]; name: string; activeImage?: CatalogImage | null }) {
  const all = useMemo(() => {
    if (!activeImage) return images;
    return [activeImage, ...images.filter((i) => i.url !== activeImage.url)];
  }, [images, activeImage]);
  const [index, setIndex] = useState(0);
  const [zoom, setZoom] = useState<{ x: number; y: number } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => setIndex(0), [activeImage?.url]);
  const current = all[index] ?? null;

  if (!current) return <ProductImage image={null} name={name} sizes="(min-width: 1024px) 50vw, 100vw" />;

  return (
    <div>
      <button
        type="button"
        className="relative block w-full cursor-zoom-in overflow-hidden"
        aria-label={`Ampliar imagem ${index + 1} de ${all.length}`}
        onClick={() => dialog.current?.showModal()}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setZoom({ x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 });
        }}
        onMouseLeave={() => setZoom(null)}
      >
        <div
          className="transition-transform duration-200"
          style={zoom ? { transform: "scale(1.9)", transformOrigin: `${zoom.x}% ${zoom.y}%` } : undefined}
        >
          <ProductImage image={current} name={name} sizes="(min-width: 1024px) 50vw, 100vw" priority />
        </div>
      </button>
      {all.length > 1 && (
        <ul className="mt-3 grid grid-cols-5 gap-2" aria-label="Imagens do produto">
          {all.map((img, i) => (
            <li key={img.url}>
              <button
                type="button"
                onClick={() => setIndex(i)}
                aria-label={`Ver imagem ${i + 1} de ${all.length}`}
                aria-current={i === index}
                className={cx("block w-full border", i === index ? "border-ink" : "border-transparent")}
              >
                <ProductImage image={img} name={name} sizes="96px" aspect="1 / 1" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <dialog ref={dialog} aria-label={`${name} — imagem ampliada`} className="m-auto max-h-[95vh] max-w-[95vw] bg-paper p-0">
        <div className="sticky top-0 flex items-center justify-between bg-paper px-4 py-2">
          <span className="text-sm text-muted">
            {index + 1} / {all.length}
          </span>
          <div className="flex items-center gap-2">
            {all.length > 1 && (
              <>
                <button type="button" className="px-3 py-2 text-sm" onClick={() => setIndex((i) => (i - 1 + all.length) % all.length)}>
                  Anterior
                </button>
                <button type="button" className="px-3 py-2 text-sm" onClick={() => setIndex((i) => (i + 1) % all.length)}>
                  Próxima
                </button>
              </>
            )}
            <button type="button" className="p-2" aria-label="Fechar" onClick={() => dialog.current?.close()}>
              <CloseIcon />
            </button>
          </div>
        </div>
        <img src={imgixSrc(current.url, { w: 2000, fit: "max" })} alt={current.alt} className="block h-auto w-[min(1600px,95vw)]" />
      </dialog>
    </div>
  );
}

export function Videos({ videos }: { videos: CatalogVideo[] }) {
  if (videos.length === 0) return null;
  return (
    <section aria-labelledby="videos" className="mt-16">
      <h2 id="videos" className="mb-6 text-2xl">
        Vídeos
      </h2>
      <ul className="grid gap-6 md:grid-cols-2">
        {videos.map((v) => (
          <li key={v.src} className="aspect-video bg-paper-deep">
            {v.provider === "file" ? (
              <video controls preload="none" poster={v.poster?.url} className="h-full w-full" aria-label={v.title}>
                <source src={v.src} type="video/mp4" />
              </video>
            ) : (
              <iframe
                src={v.src}
                title={v.title}
                loading="lazy"
                allow="accelerometer; encrypted-media; gyroscope; picture-in-picture; fullscreen"
                referrerPolicy="strict-origin-when-cross-origin"
                className="h-full w-full"
              />
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

// --- Variant selection ---------------------------------------------------------------
const DIMENSIONS: { key: keyof VariantOptions; label: string }[] = [
  { key: "size", label: "Tamanho" },
  { key: "color", label: "Cor" },
  { key: "material", label: "Material" },
  { key: "other", label: "Opção" },
];

type Selection = Partial<Record<keyof VariantOptions, string>>;

function matches(v: CatalogVariant, selection: Selection, except?: keyof VariantOptions) {
  return DIMENSIONS.every(({ key }) => key === except || !selection[key] || v.options[key] === selection[key]);
}

export function useVariantSelection(product: CatalogProduct) {
  const [params, setParams] = useSearchParams();
  const dims = DIMENSIONS.filter((d) => product.variants.some((v) => v.options[d.key]));
  const fromUrl = product.variants.find((v) => v.sku === params.get("variante"));
  const initial: Selection = fromUrl
    ? Object.fromEntries(dims.map((d) => [d.key, fromUrl.options[d.key] ?? undefined]))
    : product.variants.length === 1
      ? Object.fromEntries(dims.map((d) => [d.key, product.variants[0]!.options[d.key] ?? undefined]))
      : {};
  const [selection, setSelection] = useState<Selection>(initial);
  const selected =
    product.variants.length === 0
      ? null
      : (product.variants.find((v) => dims.every((d) => (v.options[d.key] ?? undefined) === selection[d.key])) ?? null);

  const choose = (key: keyof VariantOptions, value: string) => {
    const next = { ...selection, [key]: selection[key] === value ? undefined : value };
    setSelection(next);
    const variant = product.variants.find((v) => dims.every((d) => (v.options[d.key] ?? undefined) === next[d.key]));
    setParams(
      (p) => {
        if (variant) p.set("variante", variant.sku);
        else p.delete("variante");
        return p;
      },
      { replace: true, preventScrollReset: true },
    );
  };
  return { dims, selection, selected, choose };
}

export function VariantPicker({ product, state }: { product: CatalogProduct; state: ReturnType<typeof useVariantSelection> }) {
  const { dims, selection, choose } = state;
  if (dims.length === 0) return null;
  return (
    <div className="space-y-5">
      {dims.map(({ key, label }) => {
        const values = [...new Set(product.variants.map((v) => v.options[key]).filter((v): v is string => Boolean(v)))];
        return (
          <fieldset key={key}>
            <legend className="mb-2 text-sm">
              {label}
              {selection[key] && <span className="text-muted">: {selection[key]}</span>}
            </legend>
            <div className="flex flex-wrap gap-2">
              {values.map((value) => {
                const candidates = product.variants.filter((v) => v.options[key] === value && matches(v, selection, key));
                const sellable = candidates.some((v) => v.purchasable);
                const swatch = key === "color" ? candidates[0]?.colorSwatch : null;
                const active = selection[key] === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={active}
                    disabled={candidates.length === 0}
                    onClick={() => choose(key, value)}
                    className={cx(
                      "flex min-h-11 min-w-11 items-center gap-2 rounded-full border px-4 text-sm transition-colors",
                      active ? "border-ink bg-ink text-paper" : "border-line-strong hover:border-ink",
                      !sellable && "text-muted line-through decoration-1",
                      candidates.length === 0 && "cursor-not-allowed opacity-40",
                    )}
                  >
                    {swatch && <span aria-hidden="true" className="h-4 w-4 rounded-full border border-line" style={{ background: swatch }} />}
                    {value}
                    {!sellable && <span className="sr-only"> (indisponível)</span>}
                  </button>
                );
              })}
            </div>
          </fieldset>
        );
      })}
    </div>
  );
}

// --- Purchase panel ------------------------------------------------------------------------
export function PurchasePanel({ product, state }: { product: CatalogProduct; state: ReturnType<typeof useVariantSelection> }) {
  const navigate = useNavigate();
  const [quantity, setQuantity] = useState(1);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const saved = useWishlist().includes(product.id);
  const variant = state.selected;
  const needsChoice = product.variants.length > 0 && !variant;
  const sku = product.variants.length > 0 ? (variant?.sku ?? null) : product.sku;
  const purchasable = product.variants.length > 0 ? Boolean(variant?.purchasable) : product.purchasable;
  const availability = variant?.availability ?? product.availability;
  const priceCents = variant ? variant.priceCents : product.priceCents;

  const add = () => {
    if (!sku || !purchasable) return false;
    if (!cart.add({ productId: product.id, sku, quantity })) {
      setMessage({
        ok: false,
        text: `Seu carrinho já tem ${MAX_CART_LINES} produtos diferentes. Finalize a compra ou remova um item para adicionar este.`,
      });
      return false;
    }
    setMessage({ ok: true, text: `${quantity} × ${product.name}${variant ? ` (${variant.name})` : ""} adicionado ao carrinho.` });
    return true;
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Price
          className="text-2xl"
          cents={priceCents}
          originalCents={variant ? null : product.originalPriceCents}
          discountPercent={variant ? null : product.discountPercent}
          from={product.variants.length > 0 && !variant && new Set(product.variants.map((v) => v.priceCents)).size > 1}
        />
        <AvailabilityBadge availability={availability} className="border border-line" />
      </div>
      {sku && <p className="text-sm text-muted">SKU: {sku}</p>}

      <VariantPicker product={product} state={state} />

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="quantidade" className="mb-2 block text-sm">
            Quantidade
          </label>
          <div className="flex items-center rounded-full border border-line-strong">
            <button type="button" className="h-11 w-11" aria-label="Diminuir quantidade" onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
              −
            </button>
            <input
              id="quantidade"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_LINE_QUANTITY}
              value={quantity}
              onChange={(e) => setQuantity(Math.min(MAX_LINE_QUANTITY, Math.max(1, Math.floor(Number(e.target.value) || 1))))}
              className="h-11 w-12 bg-transparent text-center [appearance:textfield]"
            />
            <button type="button" className="h-11 w-11" aria-label="Aumentar quantidade" onClick={() => setQuantity((q) => Math.min(MAX_LINE_QUANTITY, q + 1))}>
              +
            </button>
          </div>
        </div>
        <Button className="min-h-11 flex-1" disabled={!purchasable} onClick={add}>
          {needsChoice ? "Selecione as opções" : purchasable ? "Adicionar ao carrinho" : "Indisponível"}
        </Button>
      </div>
      <div className="flex flex-wrap gap-3">
        <Button
          variant="secondary"
          className="min-h-11 flex-1"
          disabled={!purchasable}
          onClick={() => {
            if (add()) navigate("/checkout");
          }}
        >
          Comprar agora
        </Button>
        <Button variant="secondary" className="min-h-11" aria-pressed={saved} onClick={() => wishlist.toggle(product.id)}>
          <HeartIcon filled={saved} width={18} height={18} />
          {saved ? "Salvo" : "Salvar"}
        </Button>
      </div>
      <p aria-live="polite" className={cx("min-h-6 text-sm", message?.ok === false ? "text-danger" : "text-success")}>
        {message && (
          <>
            {message.text}{" "}
            <Link to="/cart" className="text-ink underline underline-offset-4">
              Ver carrinho
            </Link>
          </>
        )}
      </p>
      {!purchasable && product.priceCents === null && product.variants.length === 0 && (
        <p className="text-sm text-muted">Este produto ainda não está disponível para compra online.</p>
      )}
    </div>
  );
}

export function ShareButton({ url, title }: { url: string; title: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-wrap items-center gap-4 text-sm">
      <button
        type="button"
        className="underline underline-offset-4"
        onClick={async () => {
          if (navigator.share) {
            try {
              await navigator.share({ title, url });
              return;
            } catch {
              // user cancelled the share sheet: nothing to do
              return;
            }
          }
          await navigator.clipboard.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 2500);
        }}
      >
        Compartilhar
      </button>
      <a href={`https://wa.me/?text=${encodeURIComponent(`${title} ${url}`)}`} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
        Enviar pelo WhatsApp
      </a>
      <span aria-live="polite" className="text-success">
        {copied && "Link copiado!"}
      </span>
    </div>
  );
}
