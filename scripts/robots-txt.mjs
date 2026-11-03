// Firebase predeploy hook for hosting (see firebase.json): writes robots.txt into
// build/client/ from the project's SITE_URL.
//
// The app can't answer /robots.txt in production. Google's Functions Framework,
// which runs the deployed `ssr` function, answers /robots.txt and /favicon.ico
// itself with an empty 404 before the app sees the request (functions-framework-nodejs
// src/server.ts; production showed exactly that on 2026-11-03). Firebase Hosting
// serves files from build/client before its rewrite to the function, so the file
// is written here, right before each hosting deploy, from the same .env.<project-id>
// the functions hook checks (scripts/functions-env.mjs).
//
//   Run by `firebase deploy` (it sets GCLOUD_PROJECT, PROJECT_DIR, RESOURCE_DIR).
//   By hand (bash): GCLOUD_PROJECT=lojaiyanifa node scripts/robots-txt.mjs
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { parseEnv } from "node:util";

import { productionEnvProblems } from "./functions-env.mjs";

/**
 * robots.txt for the store at `siteUrl`. On a production origin (https, not a staging, preview or local host) private
 * and transactional areas are not crawled; search results stay crawlable but carry `noindex`. Any other site is closed
 * to crawlers entirely, so a staging or local environment never gets indexed.
 */
export function robotsTxt(siteUrl) {
  const site = siteUrl.replace(/\/+$/, ""); // as app/.server/env.ts reads SITE_URL
  const isProduction = site.startsWith("https://") && !/staging|preview|localhost/.test(site);
  const rules = isProduction
    ? [
        "User-agent: *",
        "Allow: /",
        "Disallow: /admin",
        "Disallow: /account",
        "Disallow: /orders",
        "Disallow: /cart",
        "Disallow: /checkout",
        "Disallow: /order-confirmation",
        "Disallow: /wishlist",
        "Disallow: /api/",
        "",
        `Sitemap: ${site}/sitemap.xml`,
      ]
    : ["User-agent: *", "Disallow: /"];
  return `${rules.join("\n")}\n`;
}

function fail(message) {
  console.error(`\n[robots-txt] ERROR: ${message}\n`);
  process.exit(1);
}

function main() {
  const project = process.env.GCLOUD_PROJECT;
  if (!project) fail("GCLOUD_PROJECT is not set. `firebase deploy` sets it; by hand: GCLOUD_PROJECT=<project-id> node scripts/robots-txt.mjs");
  const root = process.env.PROJECT_DIR ?? process.cwd();
  const target = process.env.RESOURCE_DIR ?? join(root, "build", "client");
  const name = `.env.${project}`;
  const source = join(root, name);
  if (!existsSync(source)) {
    fail(`${name} not found at the repo root: robots.txt for ${project} is written from its SITE_URL (see .env.example, "Production").`);
  }
  if (!existsSync(join(target, "assets"))) fail(`${target} isn't a built client: run \`npm run build\` first.`);
  const text = readFileSync(source, "utf8");
  // The same checks as the functions hook: one production config, whichever part of the site is deployed.
  const problems = productionEnvProblems(text);
  if (problems.length > 0) fail(`${name} can't be deployed:\n  - ${problems.join("\n  - ")}`);
  const robots = robotsTxt(parseEnv(text).SITE_URL.trim());
  const file = join(target, "robots.txt");
  writeFileSync(file, robots);
  console.log(`[robots-txt] ${relative(root, file)} written from ${name}:\n  ${robots.trimEnd().split("\n").join("\n  ")}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main();
