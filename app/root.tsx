import {
  isRouteErrorResponse,
  Link,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useRouteLoaderData,
} from "react-router";

import { env } from "~/.server/env";
import { getContent } from "~/.server/prismic";
import { securityMiddleware } from "~/.server/security";

import type { Route } from "./+types/root";
import "./app.css";

export const middleware: Route.MiddlewareFunction[] = [securityMiddleware];

export const links: Route.LinksFunction = () => [{ rel: "icon", href: "/favicon.svg", type: "image/svg+xml" }];

export async function loader() {
  const { settings } = await getContent();
  return {
    siteUrl: env().SITE_URL,
    storeName: settings.storeName,
    verification: settings.verification,
  };
}

export function Layout({ children }: { children: React.ReactNode }) {
  const root = useRouteLoaderData<typeof loader>("root");
  return (
    <html lang="pt-BR">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
        <meta name="theme-color" content="#f6f3ec" />
        <meta name="format-detection" content="telephone=no" />
        {root?.verification.google && <meta name="google-site-verification" content={root.verification.google} />}
        {root?.verification.bing && <meta name="msvalidate.01" content={root.verification.bing} />}
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  let title = "Algo deu errado";
  let details = "Ocorreu um erro inesperado. Tente novamente em instantes.";
  let stack: string | undefined;
  const notFound = isRouteErrorResponse(error) && error.status === 404;

  if (isRouteErrorResponse(error)) {
    if (notFound) {
      title = "Página não encontrada";
      details = "O endereço que você acessou não existe ou foi removido.";
    } else {
      title = `Erro ${error.status}`;
      details = typeof error.data === "string" && error.data ? error.data : error.statusText || details;
    }
  } else if (import.meta.env.DEV && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main id="conteudo" className="mx-auto max-w-3xl px-4 py-24 text-center md:px-8">
      <title>{`${title} | Loja Iyanifa`}</title>
      <meta name="robots" content="noindex" />
      <p className="eyebrow">{notFound ? "404" : "Erro"}</p>
      <h1 className="mt-4 text-4xl md:text-5xl">{title}</h1>
      <p className="mx-auto mt-4 max-w-md text-muted">{details}</p>
      <div className="mt-10 flex flex-wrap justify-center gap-4">
        <Link to="/" className="rounded-full bg-ink px-6 py-3 text-sm text-paper">
          Ir para a página inicial
        </Link>
        <Link to="/search" className="rounded-full border border-ink px-6 py-3 text-sm">
          Buscar produtos
        </Link>
      </div>
      {stack && (
        <pre className="mt-10 overflow-x-auto bg-surface p-4 text-left text-xs">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}
