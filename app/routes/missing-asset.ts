// /assets/* names that aren't deployed. Firebase Hosting serves every file in build/client/assets before the `**`
// rewrite, so only a name it doesn't have gets here: a page from another build asking for its CSS or JS, mostly while a
// deploy is half done (the new function goes live a few seconds before the new files).
//
// The answer is a short 404 that nothing keeps, so that page works on the next load. Before this route the store's 404
// page answered, with no Cache-Control, and Firebase sent it on as `max-age=600`: browsers and Firebase's CDN kept the
// 404 for 10 minutes (seen in production, 2026-11-04).
export function loader() {
  return new Response("Not found\n", {
    status: 404,
    headers: { "Cache-Control": "no-store", "Content-Type": "text/plain; charset=utf-8" },
  });
}
