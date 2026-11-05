import { Outlet } from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { ConsentManager } from "~/components/consent";
import { Footer, WhatsAppButton } from "~/components/footer";
import { Header } from "~/components/header";
import { buildShell } from "~/lib/shell";

import type { Route } from "./+types/store-layout";

export async function loader() {
  const { catalog, settings } = await getContent();
  return { shell: buildShell(catalog, settings, env().SITE_URL) };
}

// The shell only changes when content is published; don't refetch it on every navigation.
export function shouldRevalidate() {
  return false;
}

export default function StoreLayout({ loaderData }: Route.ComponentProps) {
  const { shell } = loaderData;
  return (
    <div id="app" className="flex min-h-dvh flex-col">
      <Header shell={shell} />
      <main id="conteudo" tabIndex={-1} className="flex-1 outline-none">
        <Outlet />
      </main>
      <Footer shell={shell} />
      <WhatsAppButton shell={shell} />
      <ConsentManager />
    </div>
  );
}
