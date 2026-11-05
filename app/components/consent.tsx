// The cookie notice and preferences (app/lib/consent.ts). The notice says plainly what the store uses today — only
// essential cookies and browser storage — and doesn't block the page. The preferences keep "análise" and
// "marketing" off unless the visitor turns them on; nothing reads them yet.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";

import { OPEN_CONSENT_EVENT, saveConsent, useConsent } from "~/lib/consent";
import { useHydrated } from "~/lib/use-hydrated";

import { Button } from "./ui";

export function ConsentManager() {
  const hydrated = useHydrated();
  const consent = useConsent();
  const dialog = useRef<HTMLDialogElement>(null);
  const [draft, setDraft] = useState({ analytics: false, marketing: false });

  useEffect(() => {
    const open = () => {
      setDraft({ analytics: consent?.analytics ?? false, marketing: consent?.marketing ?? false });
      dialog.current?.showModal();
    };
    window.addEventListener(OPEN_CONSENT_EVENT, open);
    return () => window.removeEventListener(OPEN_CONSENT_EVENT, open);
  }, [consent]);

  const save = (choice: { analytics: boolean; marketing: boolean }) => {
    saveConsent(choice);
    dialog.current?.close();
  };

  return (
    <>
      {hydrated && consent === null && (
        <div role="region" aria-label="Aviso de cookies" className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 py-4 shadow-lg md:px-8">
          <div className="mx-auto flex max-w-7xl flex-col gap-3 text-sm md:flex-row md:items-center md:justify-between">
            <p className="max-w-3xl">
              Usamos apenas cookies e dados do navegador essenciais para a loja funcionar (como o carrinho e o login). Não usamos cookies de análise nem de
              publicidade.{" "}
              <Link to="/cookies" className="underline underline-offset-4">
                Política de cookies
              </Link>
            </p>
            <div className="flex shrink-0 gap-3">
              <Button variant="secondary" onClick={() => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT))}>
                Preferências
              </Button>
              <Button onClick={() => save({ analytics: false, marketing: false })}>Entendi</Button>
            </div>
          </div>
        </div>
      )}
      <dialog ref={dialog} aria-labelledby="consent-title" className="m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto rounded-xl border border-line bg-paper p-6 text-ink backdrop:bg-ink/40">
        <h2 id="consent-title" className="text-2xl">
          Preferências de cookies
        </h2>
        <form
          method="dialog"
          className="mt-4 space-y-4 text-sm"
          onSubmit={(event) => {
            event.preventDefault();
            save(draft);
          }}
        >
          <div className="border border-line p-3">
            <p className="font-medium">Essenciais (sempre ativos)</p>
            <p className="mt-1 text-muted">Carrinho, favoritos, login e segurança do site. Sem eles a loja não funciona.</p>
          </div>
          <label className="flex gap-3 border border-line p-3">
            <input type="checkbox" checked={draft.analytics} onChange={(e) => setDraft((d) => ({ ...d, analytics: e.target.checked }))} className="mt-0.5" />
            <span>
              <span className="block font-medium">Análise</span>
              <span className="text-muted">Medir visitas para melhorar o site. Hoje não usamos nenhuma ferramenta de análise; a sua escolha fica guardada para o futuro.</span>
            </span>
          </label>
          <label className="flex gap-3 border border-line p-3">
            <input type="checkbox" checked={draft.marketing} onChange={(e) => setDraft((d) => ({ ...d, marketing: e.target.checked }))} className="mt-0.5" />
            <span>
              <span className="block font-medium">Marketing</span>
              <span className="text-muted">Anúncios e redes sociais. Hoje não usamos nenhuma ferramenta de publicidade; a sua escolha fica guardada para o futuro.</span>
            </span>
          </label>
          <div className="flex flex-wrap justify-end gap-3 pt-2">
            <Button variant="secondary" onClick={() => save({ analytics: false, marketing: false })}>
              Só os essenciais
            </Button>
            <Button type="submit">Salvar escolhas</Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
