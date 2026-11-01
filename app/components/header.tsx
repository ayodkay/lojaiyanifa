import { useEffect, useId, useRef, useState } from "react";
import { Form, Link, NavLink, useFetcher, useLocation, useNavigate } from "react-router";

import { useCartCount, useWishlist } from "~/lib/client-store";
import { imgixSrc } from "~/lib/images";
import { formatBRL } from "~/lib/money";
import type { Shell, ShellCategory } from "~/lib/shell";

import { BagIcon, ChevronDownIcon, CloseIcon, HeartIcon, MenuIcon, SearchIcon, UserIcon } from "./icons";
import { cx } from "./ui";

export interface Suggestions {
  query: string;
  products: { uid: string; name: string; priceCents: number | null; image: string | null }[];
  categories: { title: string; href: string }[];
}

const HISTORY_KEY = "li.search-history.v1";

function readHistory(): string[] {
  try {
    const v: unknown = JSON.parse(window.localStorage.getItem(HISTORY_KEY) ?? "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : [];
  } catch {
    return [];
  }
}

export function rememberSearch(query: string) {
  const q = query.trim();
  if (!q) return;
  try {
    const next = [q, ...readHistory().filter((h) => h.toLowerCase() !== q.toLowerCase())].slice(0, 5);
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: history is optional
  }
}

/** Accessible combobox (ARIA 1.2): type to get suggestions, arrows to move, Enter to open, Esc to close. */
export function SearchBox({ popular, autoFocus = false, onNavigate }: { popular: string[]; autoFocus?: boolean; onNavigate?: () => void }) {
  const fetcher = useFetcher<Suggestions>();
  const navigate = useNavigate();
  const listId = useId();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [history, setHistory] = useState<string[]>([]);
  const wrapper = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) return;
    const timer = setTimeout(() => fetcher.load(`/api/search/suggest?q=${encodeURIComponent(q)}`), 150);
    return () => clearTimeout(timer);
    // fetcher is stable for our purposes; re-running on it would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  useEffect(() => {
    const close = (event: MouseEvent) => {
      if (wrapper.current && !wrapper.current.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const showingHistory = query.trim().length < 2;
  const data = !showingHistory && fetcher.data?.query === query.trim() ? fetcher.data : null;
  const options: { key: string; label: string; href: string; detail?: string; image?: string | null }[] = showingHistory
    ? [...history.map((h) => ({ key: `h-${h}`, label: h, href: `/search?q=${encodeURIComponent(h)}`, detail: "Busca recente" })),
       ...popular.filter((p) => !history.includes(p)).slice(0, 5).map((p) => ({ key: `p-${p}`, label: p, href: `/search?q=${encodeURIComponent(p)}`, detail: "Sugestão" }))]
    : [
        ...(data?.categories ?? []).map((c) => ({ key: `c-${c.href}`, label: c.title, href: c.href, detail: "Categoria" })),
        ...(data?.products ?? []).map((p) => ({
          key: `p-${p.uid}`,
          label: p.name,
          href: `/products/${p.uid}`,
          detail: p.priceCents !== null ? formatBRL(p.priceCents) : undefined,
          image: p.image,
        })),
      ];
  const expanded = open && options.length > 0;

  const go = (href: string) => {
    setOpen(false);
    onNavigate?.();
    navigate(href);
  };

  return (
    <div ref={wrapper} className="relative w-full">
      <Form
        method="get"
        action="/search"
        role="search"
        onSubmit={() => {
          rememberSearch(query);
          setOpen(false);
          onNavigate?.();
        }}
      >
        <label htmlFor={`${listId}-input`} className="sr-only">
          Buscar produtos
        </label>
        <div className="flex items-center gap-2 rounded-[var(--radius-control)] border border-line-strong bg-surface px-4 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-focus">
          <SearchIcon className="shrink-0 text-muted" />
          <input
            id={`${listId}-input`}
            name="q"
            type="search"
            autoComplete="off"
            autoFocus={autoFocus}
            placeholder="Buscar produtos, SKU, categorias…"
            className="w-full bg-transparent py-2.5 text-base outline-none placeholder:text-muted"
            role="combobox"
            aria-expanded={expanded}
            aria-controls={listId}
            aria-autocomplete="list"
            aria-activedescendant={expanded && active >= 0 ? `${listId}-${active}` : undefined}
            value={query}
            onFocus={() => {
              setHistory(readHistory());
              setOpen(true);
            }}
            onChange={(e) => {
              setQuery(e.target.value);
              setActive(-1);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") {
                e.preventDefault();
                setOpen(true);
                setActive((i) => Math.min(options.length - 1, i + 1));
              } else if (e.key === "ArrowUp") {
                e.preventDefault();
                setActive((i) => Math.max(-1, i - 1));
              } else if (e.key === "Escape") {
                setOpen(false);
                setActive(-1);
              } else if (e.key === "Enter" && expanded && active >= 0) {
                e.preventDefault();
                const option = options[active];
                if (option) go(option.href);
              }
            }}
          />
        </div>
      </Form>
      <ul
        id={listId}
        role="listbox"
        aria-label="Sugestões de busca"
        className={cx(
          "absolute left-0 right-0 top-full z-50 mt-2 max-h-[70vh] overflow-auto border border-line bg-surface py-2 shadow-lg",
          !expanded && "hidden",
        )}
      >
        {options.map((option, i) => (
          <li
            key={option.key}
            id={`${listId}-${i}`}
            role="option"
            aria-selected={i === active}
            className={cx("flex cursor-pointer items-center gap-3 px-4 py-2 text-sm", i === active && "bg-paper")}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(e) => {
              e.preventDefault(); // keep focus; navigate on mouse down before blur closes the list
              go(option.href);
            }}
          >
            {option.image !== undefined && (
              <span className="block h-10 w-8 shrink-0 overflow-hidden bg-paper-deep">
                {option.image && <img src={option.image} alt="" className="h-full w-full object-cover" loading="lazy" />}
              </span>
            )}
            <span className="flex-1 text-ink">{option.label}</span>
            {option.detail && <span className="text-xs text-muted">{option.detail}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function MegaMenu({ menu }: { menu: ShellCategory[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const location = useLocation();
  const navRef = useRef<HTMLElement>(null);

  useEffect(() => setOpen(null), [location.pathname, location.search]);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(null);
    const onClick = (e: MouseEvent) => navRef.current && !navRef.current.contains(e.target as Node) && setOpen(null);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const linkClass = ({ isActive }: { isActive: boolean }) =>
    cx("py-2 text-sm tracking-wide hover:text-ink", isActive ? "text-ink underline underline-offset-8" : "text-ink-soft");

  return (
    <nav ref={navRef} aria-label="Categorias" className="hidden lg:block">
      <ul className="flex items-center gap-7">
        <li>
          <NavLink to="/collections/all" className={linkClass}>
            Todos os produtos
          </NavLink>
        </li>
        {menu.map((item) =>
          item.children.length === 0 ? (
            <li key={item.id}>
              <NavLink to={item.href} className={linkClass}>
                {item.title}
              </NavLink>
            </li>
          ) : (
            <li key={item.id}>
              <button
                type="button"
                className="flex items-center gap-1 py-2 text-sm tracking-wide text-ink-soft hover:text-ink"
                aria-expanded={open === item.id}
                aria-controls={`mega-${item.id}`}
                onClick={() => setOpen((v) => (v === item.id ? null : item.id))}
              >
                {item.title}
                <ChevronDownIcon className={cx("transition-transform", open === item.id && "rotate-180")} />
              </button>
              <div
                id={`mega-${item.id}`}
                hidden={open !== item.id}
                className="absolute inset-x-0 top-full border-y border-line bg-paper shadow-sm"
              >
                <div className="mx-auto grid max-w-7xl grid-cols-[1fr_auto] gap-10 px-8 py-10">
                  <div>
                    <p className="eyebrow mb-4">{item.title}</p>
                    <ul className="grid grid-cols-3 gap-x-10 gap-y-3">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link to={child.href} className="font-display text-xl text-ink hover:underline">
                            {child.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                    <Link to={item.href} className="mt-8 inline-block text-sm text-ink underline underline-offset-4">
                      Ver tudo em {item.title}
                    </Link>
                  </div>
                  {item.image && (
                    <img src={imgixSrc(item.image.url, { w: 360, ar: "4:5", fit: "crop" })} alt="" className="h-56 w-44 object-cover" loading="lazy" />
                  )}
                </div>
              </div>
            </li>
          ),
        )}
      </ul>
    </nav>
  );
}

function MobileMenu({ shell }: { shell: Shell }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const location = useLocation();
  useEffect(() => dialog.current?.close(), [location.pathname, location.search]);
  const close = () => dialog.current?.close();

  return (
    <>
      <button type="button" className="-ml-2 p-2 lg:hidden" aria-label="Abrir menu" onClick={() => dialog.current?.showModal()}>
        <MenuIcon />
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        className="m-0 h-dvh max-h-none w-[min(24rem,90vw)] max-w-none bg-paper p-0 text-ink"
        onClick={(e) => e.target === dialog.current && close()}
      >
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <span className="font-display text-xl">{shell.storeName}</span>
          <button type="button" className="p-2" aria-label="Fechar menu" onClick={close}>
            <CloseIcon />
          </button>
        </div>
        <div className="space-y-8 px-5 py-6">
          <SearchBox popular={shell.popularSearches} onNavigate={close} />
          <nav aria-label="Categorias">
            <ul className="space-y-4">
              <li>
                <Link to="/collections/all" className="font-display text-2xl">
                  Todos os produtos
                </Link>
              </li>
              {shell.menu.map((item) => (
                <li key={item.id}>
                  <Link to={item.href} className="font-display text-2xl">
                    {item.title}
                  </Link>
                  {item.children.length > 0 && (
                    <ul className="mt-2 space-y-2 border-l border-line pl-4">
                      {item.children.map((child) => (
                        <li key={child.href}>
                          <Link to={child.href} className="text-ink-soft">
                            {child.title}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
              {shell.collections.length > 0 && (
                <li className="pt-4">
                  <p className="eyebrow mb-3">Coleções</p>
                  <ul className="space-y-2">
                    {shell.collections.map((c) => (
                      <li key={c.href}>
                        <Link to={c.href} className="text-ink-soft">
                          {c.title}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              )}
            </ul>
          </nav>
          <ul className="space-y-3 border-t border-line pt-6 text-ink-soft">
            <li><Link to="/account">Minha conta</Link></li>
            <li><Link to="/orders">Meus pedidos</Link></li>
            <li><Link to="/wishlist">Lista de desejos</Link></li>
            <li><Link to="/contact">Atendimento</Link></li>
          </ul>
        </div>
      </dialog>
    </>
  );
}

function CountBadge({ count }: { count: number }) {
  if (count <= 0) return null;
  return (
    <span className="absolute -right-1 -top-1 grid h-5 min-w-5 place-items-center rounded-full bg-ink px-1 text-[0.65rem] font-medium text-paper">
      {count > 99 ? "99+" : count}
    </span>
  );
}

export function Header({ shell }: { shell: Shell }) {
  const cartCount = useCartCount();
  const wishlistCount = useWishlist().length;
  const [mobileSearch, setMobileSearch] = useState(false);
  const location = useLocation();
  useEffect(() => setMobileSearch(false), [location.pathname, location.search]);

  return (
    <>
      <a
        href="#conteudo"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:bg-ink focus:px-4 focus:py-2 focus:text-paper"
      >
        Pular para o conteúdo
      </a>
      {shell.announcement && (
        <div className="bg-ink px-4 py-2 text-center text-sm text-paper">
          {shell.announcement.href ? (
            <Link to={shell.announcement.href} className="underline-offset-4 hover:underline">
              {shell.announcement.text}
            </Link>
          ) : (
            shell.announcement.text
          )}
        </div>
      )}
      <header className="sticky top-0 z-40 border-b border-line bg-paper/95 backdrop-blur supports-[backdrop-filter]:bg-paper/85">
        <div className="relative mx-auto flex h-16 max-w-7xl items-center gap-3 px-4 md:h-20 md:gap-6 md:px-8">
          <MobileMenu shell={shell} />
          <Link to="/" className="shrink-0" aria-label={`${shell.storeName} — página inicial`}>
            {shell.logo ? (
              <img src={imgixSrc(shell.logo.url, { h: 96 })} alt={shell.storeName} className="h-9 w-auto md:h-11" />
            ) : (
              <span className="font-display text-2xl tracking-tight md:text-[1.7rem]">{shell.storeName}</span>
            )}
          </Link>
          <MegaMenu menu={shell.menu} />
          <div className="ml-auto hidden w-full max-w-sm md:block">
            <SearchBox popular={shell.popularSearches} />
          </div>
          <nav aria-label="Conta e carrinho" className="ml-auto flex items-center gap-1 md:ml-0">
            <button
              type="button"
              className="p-2 md:hidden"
              aria-label="Buscar"
              aria-expanded={mobileSearch}
              aria-controls="busca-mobile"
              onClick={() => setMobileSearch((v) => !v)}
            >
              <SearchIcon />
            </button>
            <Link to="/wishlist" className="relative hidden p-2 sm:block" aria-label={`Lista de desejos (${wishlistCount} ${wishlistCount === 1 ? "item" : "itens"})`}>
              <HeartIcon />
              <CountBadge count={wishlistCount} />
            </Link>
            <Link to="/account" className="p-2" aria-label="Minha conta">
              <UserIcon />
            </Link>
            <Link to="/cart" className="relative p-2" aria-label={`Carrinho (${cartCount} ${cartCount === 1 ? "item" : "itens"})`}>
              <BagIcon />
              <CountBadge count={cartCount} />
            </Link>
          </nav>
        </div>
        <div id="busca-mobile" hidden={!mobileSearch} className="border-t border-line px-4 py-3 md:hidden">
          {mobileSearch && <SearchBox popular={shell.popularSearches} autoFocus />}
        </div>
      </header>
    </>
  );
}
