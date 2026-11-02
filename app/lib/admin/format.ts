/** Dates in the store's time zone, the same on the server and in the browser (no hydration mismatch). */
export const adminDateTime = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" });
