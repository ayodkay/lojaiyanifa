// Admin pages: a title and noindex. React Router uses the deepest route's
// meta, so every admin page must return this (the X-Robots-Tag header set by
// the admin middleware is the second layer).
export const adminMeta = (title: string) => [
  { title: `${title} | Painel da Loja Iyanifa` },
  { name: "robots", content: "noindex, nofollow" },
];
