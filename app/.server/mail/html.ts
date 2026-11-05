// Safe HTML for e-mails: every interpolated value is escaped unless it was built by `html` itself. Customer-typed
// text (names, addresses) goes into these e-mails, so nothing may reach the markup unescaped.

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export const escapeHtml = (value: string): string => value.replace(/[&<>"']/g, (ch) => ESCAPES[ch]!);

/** Markup that is already safe (built by `html`). */
export class SafeHtml {
  constructor(readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

type Interpolation = SafeHtml | string | number | null | undefined | false | readonly Interpolation[];

function render(value: Interpolation): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof SafeHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(String(value));
}

/** Tagged template: `html\`<p>${name}</p>\`` escapes `name`; nested `html` results stay as they are. */
export function html(strings: TemplateStringsArray, ...values: Interpolation[]): SafeHtml {
  let out = strings[0]!;
  values.forEach((value, i) => {
    out += render(value) + strings[i + 1]!;
  });
  return new SafeHtml(out);
}

/** An https URL, or null: links in e-mails never carry javascript:, data: or plain http targets. */
export function safeUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || (url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1")) ? url.href : null;
  } catch {
    return null;
  }
}
