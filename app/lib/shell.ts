// Data for the storefront shell (header, navigation, footer). Public info only:
// it is rendered into cached HTML for every visitor.
import { childCategories, topLevelCategories, type Catalog } from "~/lib/catalog/query";
import type { BusinessHours, CatalogCategory, CatalogImage, StoreSettings } from "~/lib/catalog/types";

export function categoryHref(category: Pick<CatalogCategory, "kind" | "uid">): string {
  return category.kind === "collection" ? `/collections/${category.uid}` : `/categories/${category.uid}`;
}

export interface ShellLink {
  title: string;
  href: string;
}

export interface ShellCategory extends ShellLink {
  id: string;
  image: CatalogImage | null;
  children: ShellLink[];
}

export interface Shell {
  siteUrl: string;
  storeName: string;
  tagline: string | null;
  logo: CatalogImage | null;
  announcement: { text: string; href: string | null } | null;
  menu: ShellCategory[];
  collections: ShellLink[];
  popularSearches: string[];
  contact: StoreSettings["contact"];
  company: StoreSettings["company"];
  socialLinks: StoreSettings["socialLinks"];
  footerLinks: StoreSettings["footerLinks"];
}

const byTitle = (a: { title: string }, b: { title: string }) => a.title.localeCompare(b.title, "pt-BR");

export function buildShell(catalog: Catalog, settings: StoreSettings, siteUrl: string): Shell {
  const curated = settings.menuCategoryIds
    .map((id) => catalog.categoriesById.get(id))
    .filter((c): c is CatalogCategory => Boolean(c));
  const top = curated.length > 0 ? curated : topLevelCategories(catalog, "category").sort(byTitle);
  return {
    siteUrl,
    storeName: settings.storeName,
    tagline: settings.tagline,
    logo: settings.logo,
    announcement: settings.announcement ? { text: settings.announcement, href: settings.announcementHref } : null,
    menu: top.map((c) => ({
      id: c.id,
      title: c.title,
      href: categoryHref(c),
      image: c.image,
      children: childCategories(catalog, c.id)
        .sort(byTitle)
        .map((child) => ({ title: child.title, href: categoryHref(child) })),
    })),
    collections: topLevelCategories(catalog, "collection")
      .sort(byTitle)
      .map((c) => ({ title: c.title, href: categoryHref(c) })),
    popularSearches: settings.popularSearches,
    contact: settings.contact,
    company: settings.company,
    socialLinks: settings.socialLinks,
    footerLinks: settings.footerLinks,
  };
}

const WEEKDAYS = ["domingo", "segunda", "terça", "quarta", "quinta", "sexta", "sábado"];

/** "segunda a sexta, 09:00–18:00" style lines, grouping consecutive days with the same hours. */
export function formatHours(hours: BusinessHours[]): string[] {
  const sorted = [...hours].sort((a, b) => ((a.day + 6) % 7) - ((b.day + 6) % 7)); // Monday first
  const lines: string[] = [];
  let i = 0;
  while (i < sorted.length) {
    const start = sorted[i]!;
    let j = i;
    while (
      j + 1 < sorted.length &&
      sorted[j + 1]!.opens === start.opens &&
      sorted[j + 1]!.closes === start.closes &&
      (sorted[j + 1]!.day + 6) % 7 === ((sorted[j]!.day + 6) % 7) + 1
    ) {
      j++;
    }
    const days = i === j ? WEEKDAYS[start.day] : `${WEEKDAYS[start.day]} a ${WEEKDAYS[sorted[j]!.day]}`;
    lines.push(`${days}, ${start.opens}–${start.closes}`);
    i = j + 1;
  }
  return lines;
}

/** Is the store open right now in São Paulo time? null when no hours are configured. */
export function isOpenNow(hours: BusinessHours[], now = new Date()): boolean | null {
  if (hours.length === 0) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.find((p) => p.type === "weekday")!.value);
  const hhmm = `${parts.find((p) => p.type === "hour")!.value}:${parts.find((p) => p.type === "minute")!.value}`;
  return hours.some((h) => h.day === weekday && hhmm >= h.opens && hhmm < h.closes);
}

export function whatsappHref(number: string, message?: string | null): string {
  const text = message ? `?text=${encodeURIComponent(message)}` : "";
  return `https://wa.me/${number}${text}`;
}
