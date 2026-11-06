import { describe, expect, it } from "vitest";

import { emptySettings } from "~/lib/catalog/map";
import type { ContentPage, Homepage, StoreSettings } from "~/lib/catalog/types";
import { llmsTxt, localBusinessJsonLd, STORE_DESCRIPTION } from "~/lib/store-profile";

import { catalogOf, catalogProduct } from "../factories";

// Neutral values only: the store's real phone, address and profiles live in the Prismic settings, never in the repository.
function settings(
  overrides: {
    contact?: Partial<StoreSettings["contact"]>;
    company?: Partial<StoreSettings["company"]>;
    socialLinks?: StoreSettings["socialLinks"];
  } = {},
): StoreSettings {
  const base = emptySettings();
  return {
    ...base,
    ...overrides,
    contact: { ...base.contact, ...overrides.contact },
    company: { ...base.company, ...overrides.company },
  };
}

const ADDRESS = { addressLine: "Rua Exemplo, 100, Loja 1", city: "São Paulo", state: "SP", postalCode: "01001-000" };
// As mapSettings keeps them: day 0 = Sunday … 6 = Saturday, hh:mm.
const hours = (days: number[], opens: string, closes: string) => days.map((day) => ({ day, opens, closes }));

const PROFILES = [
  { network: "Instagram", href: "https://www.instagram.com/exemplo/" },
  { network: "TikTok", href: "https://www.tiktok.com/@exemplo" },
];

describe("localBusinessJsonLd", () => {
  it("describes the store with its phone in international format, its address, its hours and its social profiles", () => {
    const s = settings({
      contact: { phone: "(21) 98765-4321", hours: [...hours([1, 2, 3, 4, 5], "09:00", "18:00"), ...hours([6], "09:00", "13:00")] },
      company: ADDRESS,
      socialLinks: PROFILES,
    });
    expect(localBusinessJsonLd(s, "https://loja.example")).toEqual({
      "@context": "https://schema.org",
      "@type": "LocalBusiness",
      name: "Loja Iyanifa",
      description: STORE_DESCRIPTION,
      url: "https://loja.example/",
      telephone: "+5521987654321",
      address: {
        "@type": "PostalAddress",
        streetAddress: "Rua Exemplo, 100, Loja 1",
        addressLocality: "São Paulo",
        addressRegion: "SP",
        postalCode: "01001-000",
        addressCountry: "BR",
      },
      openingHoursSpecification: [
        {
          "@type": "OpeningHoursSpecification",
          dayOfWeek: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"],
          opens: "09:00:00",
          closes: "18:00:00",
        },
        { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday"], opens: "09:00:00", closes: "13:00:00" },
      ],
      sameAs: ["https://www.instagram.com/exemplo/", "https://www.tiktok.com/@exemplo"],
    });
  });

  it("leaves telephone, address, hours and sameAs out while the settings have none of them", () => {
    // A city and state alone don't locate a store.
    const data = localBusinessJsonLd(settings({ company: { city: "São Paulo", state: "SP" } }), "https://loja.example");
    expect(data).not.toHaveProperty("telephone");
    expect(data).not.toHaveProperty("address");
    expect(data).not.toHaveProperty("openingHoursSpecification");
    expect(data).not.toHaveProperty("sameAs");
  });

  it("lists the hours Monday first, Sunday last, and a split shift as two slots", () => {
    const rows = [
      ...hours([0], "10:00", "14:00"),
      ...hours([6], "10:00", "14:00"),
      ...hours([1], "09:00", "12:00"),
      ...hours([1], "14:00", "18:00"),
    ];
    expect(localBusinessJsonLd(settings({ contact: { hours: rows } }), "https://loja.example").openingHoursSpecification).toEqual([
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday"], opens: "09:00:00", closes: "12:00:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Monday"], opens: "14:00:00", closes: "18:00:00" },
      { "@type": "OpeningHoursSpecification", dayOfWeek: ["Saturday", "Sunday"], opens: "10:00:00", closes: "14:00:00" },
    ]);
  });

  it("writes only the address parts the settings have", () => {
    const s = settings({ company: { addressLine: "Rua Exemplo, 100", city: "São Paulo" } });
    expect(localBusinessJsonLd(s, "https://loja.example").address).toEqual({
      "@type": "PostalAddress",
      streetAddress: "Rua Exemplo, 100",
      addressLocality: "São Paulo",
      addressCountry: "BR",
    });
  });
});

const ABOUT: ContentPage = {
  id: "page-about", uid: "about", title: "Sobre a loja", body: [], lastUpdated: null,
  seo: { title: null, description: null, image: null },
};

describe("llmsTxt", () => {
  it("lists the home page, the about page and every product under their page titles, then the profiles", () => {
    const catalog = catalogOf([
      catalogProduct("p1", { uid: "pano-da-costa", name: "Pano da costa" }),
      catalogProduct("p2", { uid: "ose-dudu", name: "Ose dudu", seo: { title: "Sabão preto", description: null, image: null } }),
      catalogProduct("p3", { uid: "aridan", name: "Aridan" }),
    ]);
    const s = settings({
      contact: { whatsappNumber: "5521987654321", whatsappMessage: "Ola! Vim pelo site da Loja Iyanifa" },
      socialLinks: PROFILES,
    });
    expect(
      llmsTxt({ siteUrl: "https://loja.example", catalog, settings: s, homepage: null, pages: new Map([["about", ABOUT]]) }),
    ).toBe(
      [
        "# Loja Iyanifa",
        "",
        "> A Loja Iyanifa é uma loja online que vende artigos religiosos de tradição iorubá, incluindo ferramentas de Ifá, sementes, panos da costa, roupas e banhos. Oferece pagamento via Pix e entrega para todo o Brasil.",
        "",
        "## Offerings",
        "",
        "- Ferramentas de Ifá: Ferramentas utilizadas em rituais e práticas religiosas da tradição iorubá.",
        "- Sementes: Sementes com significado simbólico e espiritual na tradição iorubá.",
        "- Panos da Costa: Panos tradicionais usados em cerimônias e rituais religiosos.",
        "- Roupas e Banhos: Produtos destinados à preparação espiritual e ritualística.",
        "",
        "## Pages",
        "",
        "- [Loja Iyanifa](https://loja.example/)",
        "- [Sobre a loja | Loja Iyanifa](https://loja.example/about)",
        "- [Aridan | Loja Iyanifa](https://loja.example/products/aridan)",
        "- [Pano da costa | Loja Iyanifa](https://loja.example/products/pano-da-costa)",
        "- [Sabão preto | Loja Iyanifa](https://loja.example/products/ose-dudu)",
        "",
        "## Profiles",
        "",
        "- instagram: https://www.instagram.com/exemplo/",
        "- tiktok: https://www.tiktok.com/@exemplo",
        "- whatsapp: https://wa.me/5521987654321?text=Ola!%20Vim%20pelo%20site%20da%20Loja%20Iyanifa",
        "",
        "Website: https://loja.example/",
        "",
      ].join("\n"),
    );
  });

  it("titles the home link as the home page does, and drops what Prismic doesn't have", () => {
    // Only `seo` is read from the homepage.
    const homepage = { seo: { title: "Artigos religiosos", description: null, image: null } } as Homepage;
    const text = llmsTxt({ siteUrl: "https://loja.example", catalog: catalogOf([]), settings: settings(), homepage, pages: new Map() });
    expect(text).toContain("## Pages\n\n- [Artigos religiosos | Loja Iyanifa](https://loja.example/)\n\nWebsite:");
    expect(text).not.toContain("/about");
    expect(text).not.toContain("## Profiles");
  });
});
