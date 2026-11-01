import { PrismicRichText } from "@prismicio/react";
import type { RichTextField } from "@prismicio/client";
import { useRef } from "react";
import { Form, Link, useLocation, useNavigation, useSubmit } from "react-router";

import type { Listing } from "~/lib/catalog/listing";
import { SORT_OPTIONS } from "~/lib/catalog/query";
import { formatBRL } from "~/lib/money";

import { ProductGrid } from "./product-card";
import { Breadcrumbs, cx } from "./ui";

function pageHref(search: string, page: number) {
  const params = new URLSearchParams(search);
  if (page <= 1) params.delete("pagina");
  else params.set("pagina", String(page));
  const q = params.toString();
  return q ? `?${q}` : "?";
}

export function Pagination({ page, pageCount }: { page: number; pageCount: number }) {
  const { search } = useLocation();
  if (pageCount <= 1) return null;
  const pages = Array.from({ length: pageCount }, (_, i) => i + 1).filter(
    (p) => p === 1 || p === pageCount || Math.abs(p - page) <= 1,
  );
  return (
    <nav aria-label="Paginação" className="mt-16 flex items-center justify-center gap-2 text-sm">
      {page > 1 && (
        <Link to={pageHref(search, page - 1)} rel="prev" className="px-3 py-2 underline-offset-4 hover:underline">
          Anterior
        </Link>
      )}
      {pages.map((p, i) => (
        <span key={p} className="flex items-center gap-2">
          {i > 0 && p - pages[i - 1]! > 1 && <span aria-hidden="true">…</span>}
          <Link
            to={pageHref(search, p)}
            aria-current={p === page ? "page" : undefined}
            className={cx("grid h-9 min-w-9 place-items-center rounded-full px-2", p === page ? "bg-ink text-paper" : "hover:bg-paper-deep")}
          >
            <span className="sr-only">Página </span>
            {p}
          </Link>
        </span>
      ))}
      {page < pageCount && (
        <Link to={pageHref(search, page + 1)} rel="next" className="px-3 py-2 underline-offset-4 hover:underline">
          Próxima
        </Link>
      )}
    </nav>
  );
}

function CheckboxGroup({ legend, name, options, selected }: { legend: string; name: string; options: { value: string; count: number }[]; selected: string[] }) {
  if (options.length === 0) return null;
  return (
    <fieldset className="border-t border-line py-5">
      <legend className="eyebrow mb-3 pt-5">{legend}</legend>
      <ul className="space-y-2">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-center gap-3 text-sm">
              <input type="checkbox" name={name} value={o.value} defaultChecked={selected.includes(o.value)} className="h-4 w-4 accent-[var(--color-ink)]" />
              <span className="flex-1">{o.value}</span>
              <span className="text-muted">{o.count}</span>
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** URL-driven filters: works without JavaScript (submit button), auto-applies with it. */
export function Filters({ listing, extraHidden }: { listing: Listing; extraHidden?: Record<string, string> }) {
  const { search } = useLocation();
  const params = new URLSearchParams(search);
  const submit = useSubmit();
  const form = useRef<HTMLFormElement>(null);
  const f = listing.facets;
  const apply = () => form.current && submit(form.current, { preventScrollReset: true, replace: true });

  return (
    <Form ref={form} method="get" onChange={apply} aria-label="Filtros" className="text-ink">
      {Object.entries(extraHidden ?? {}).map(([k, v]) => (
        <input key={k} type="hidden" name={k} value={v} />
      ))}
      <label className="block">
        <span className="eyebrow mb-2 block">Ordenar por</span>
        <select name="ordem" defaultValue={listing.sort} className="field">
          {SORT_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.value === "featured" && extraHidden?.q !== undefined ? "Relevância" : o.label}
            </option>
          ))}
        </select>
      </label>

      <fieldset className="mt-6 border-t border-line py-5">
        <legend className="eyebrow mb-3 pt-5">Disponibilidade</legend>
        <label className="flex cursor-pointer items-center gap-3 text-sm">
          <input type="checkbox" name="disponivel" value="1" defaultChecked={params.get("disponivel") === "1"} className="h-4 w-4 accent-[var(--color-ink)]" />
          <span className="flex-1">Somente disponíveis</span>
          <span className="text-muted">{f.availableCount}</span>
        </label>
      </fieldset>

      {f.price && f.price.max > f.price.min && (
        <fieldset className="border-t border-line py-5">
          <legend className="eyebrow mb-3 pt-5">Preço (R$)</legend>
          <div className="flex items-center gap-2">
            <label className="flex-1">
              <span className="sr-only">Preço mínimo</span>
              <input name="min" inputMode="decimal" placeholder={formatBRL(f.price.min)} defaultValue={params.get("min") ?? ""} className="field" />
            </label>
            <span aria-hidden="true">–</span>
            <label className="flex-1">
              <span className="sr-only">Preço máximo</span>
              <input name="max" inputMode="decimal" placeholder={formatBRL(f.price.max)} defaultValue={params.get("max") ?? ""} className="field" />
            </label>
          </div>
        </fieldset>
      )}

      <CheckboxGroup legend="Tamanho" name="tamanho" options={f.sizes} selected={params.getAll("tamanho")} />
      <CheckboxGroup legend="Cor" name="cor" options={f.colors} selected={params.getAll("cor")} />
      <CheckboxGroup legend="Material" name="material" options={f.materials} selected={params.getAll("material")} />

      <div className="mt-4 flex items-center gap-4">
        <button type="submit" className="rounded-full bg-ink px-5 py-2 text-sm text-paper">
          Aplicar
        </button>
        {listing.filtered && (
          <Link to={Object.keys(extraHidden ?? {}).length ? `?${new URLSearchParams(extraHidden).toString()}` : "?"} className="text-sm underline underline-offset-4">
            Limpar filtros
          </Link>
        )}
      </div>
    </Form>
  );
}

export function ListingPage({
  title,
  eyebrow,
  intro,
  breadcrumbs,
  listing,
  subcategories,
  empty,
  extraHidden,
}: {
  title: string;
  eyebrow?: string;
  intro?: RichTextField;
  breadcrumbs: { name: string; href: string }[];
  listing: Listing;
  subcategories?: { title: string; href: string }[];
  empty?: React.ReactNode;
  extraHidden?: Record<string, string>;
}) {
  const navigation = useNavigation();
  // Hooks must run on every render: read the location before the conditional.
  const { pathname } = useLocation();
  const loading = navigation.state === "loading" && navigation.location?.pathname === pathname;
  return (
    <div className="mx-auto max-w-7xl px-4 py-10 md:px-8">
      <Breadcrumbs items={breadcrumbs} />
      <header className="mb-10 mt-8 max-w-3xl">
        {eyebrow && <p className="eyebrow mb-3">{eyebrow}</p>}
        <h1 className="text-4xl md:text-6xl">{title}</h1>
        {intro && intro.length > 0 && (
          <div className="prose-store mt-5 text-lg">
            <PrismicRichText field={intro} />
          </div>
        )}
        {subcategories && subcategories.length > 0 && (
          <nav aria-label="Subcategorias" className="mt-6">
            <ul className="flex flex-wrap gap-2">
              {subcategories.map((s) => (
                <li key={s.href}>
                  <Link to={s.href} className="inline-block rounded-full border border-line-strong px-4 py-1.5 text-sm hover:border-ink">
                    {s.title}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        )}
      </header>

      <div className="grid gap-10 lg:grid-cols-[16rem_1fr]">
        <aside className="lg:sticky lg:top-28 lg:self-start">
          <details className="group lg:hidden">
            <summary className="flex cursor-pointer list-none items-center justify-between border-y border-line py-3 text-sm">
              <span>Filtrar e ordenar</span>
              <span className="text-muted">{listing.total} produtos</span>
            </summary>
            <div className="pt-4">
              <Filters listing={listing} extraHidden={extraHidden} />
            </div>
          </details>
          <div className="hidden lg:block">
            <Filters listing={listing} extraHidden={extraHidden} />
          </div>
        </aside>

        <section aria-label="Produtos" aria-busy={loading}>
          <p className="mb-6 hidden text-sm text-muted lg:block" aria-live="polite">
            {listing.total === 1 ? "1 produto" : `${listing.total} produtos`}
            {listing.filtered && ` (de ${listing.unfilteredTotal})`}
          </p>
          {listing.total === 0 ? (
            (empty ?? <p className="text-muted">Nenhum produto encontrado com esses filtros.</p>)
          ) : (
            <div className={cx("transition-opacity", loading && "opacity-50")}>
              <ProductGrid products={listing.products} priorityCount={2} />
            </div>
          )}
          <Pagination page={listing.page} pageCount={listing.pageCount} />
        </section>
      </div>
    </div>
  );
}
