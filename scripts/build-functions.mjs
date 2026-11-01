// Assembles build/functions/: the deployable Cloud Functions package.
//
// Input:  build/server/ (the SSR bundle; its entry is server/app.ts)
// Output: build/functions/
//           server/**            copy of the SSR bundle
//           package.json         only the packages the bundle actually imports,
//                                pinned to the ranges in the root package.json
//           node_modules/        installed so the Firebase CLI can load the module
//                                locally (function discovery) and emulators can run it
//           .env.local           copied for the emulator only (gitignored)
//
// Fails loudly if the bundle imports a package that isn't a root "dependency",
// because that import would crash in production.

import { execSync } from "node:child_process";
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { builtinModules } from "node:module";
import { join } from "node:path";

const root = process.cwd();
const serverDir = join(root, "build", "server");
const outDir = join(root, "build", "functions");

function fail(message) {
  console.error(`\n[build-functions] ERROR: ${message}\n`);
  process.exit(1);
}

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

if (!existsSync(join(serverDir, "index.js"))) {
  fail("build/server/index.js not found. Run `react-router build` first.");
}

const rootPkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const builtins = new Set([...builtinModules, ...builtinModules.map((m) => `node:${m}`)]);

// 1. Collect bare import specifiers from the bundle (static, re-export, side-effect, dynamic).
const importPattern =
  /(?:^|[;\s}])(?:import|export)\s*(?:[\w*{}\s,$]*?\s*from\s*)?["']([^"'./][^"']*)["']|import\(\s*["']([^"'./][^"']*)["']\s*\)/gm;
const specifiers = new Set();
for (const file of walk(serverDir).filter((f) => /\.(m?js)$/.test(f))) {
  const source = readFileSync(file, "utf8");
  for (const match of source.matchAll(importPattern)) specifiers.add(match[1] ?? match[2]);
}

const packages = new Set();
for (const spec of specifiers) {
  if (builtins.has(spec)) continue;
  if (spec.startsWith("virtual:")) fail(`Unresolved virtual module left in the server bundle: ${spec}`);
  packages.add(spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]);
}

// 2. Pin each package to the root package.json range.
const dependencies = {};
const missing = [];
for (const name of [...packages].sort()) {
  const range = rootPkg.dependencies?.[name];
  if (range) dependencies[name] = range;
  else missing.push(name);
}
if (missing.length > 0) {
  fail(`The server bundle imports packages missing from package.json "dependencies": ${missing.join(", ")}`);
}
for (const required of ["firebase-functions", "firebase-admin"]) {
  if (!dependencies[required] && rootPkg.dependencies?.[required]) {
    // firebase-admin is a peer of firebase-functions; keep both so discovery works.
    dependencies[required] = rootPkg.dependencies[required];
  }
}

// 3. Write the package.
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });
cpSync(serverDir, join(outDir, "server"), { recursive: true });
writeFileSync(
  join(outDir, "package.json"),
  `${JSON.stringify(
    {
      name: "lojaiyanifa-functions",
      private: true,
      type: "module",
      main: "server/index.js",
      engines: { node: "22" },
      dependencies,
      ...(rootPkg.overrides ? { overrides: rootPkg.overrides } : {}),
    },
    null,
    2,
  )}\n`,
);
if (existsSync(join(root, ".env.local"))) {
  copyFileSync(join(root, ".env.local"), join(outDir, ".env.local"));
}

console.log(`[build-functions] bundle imports ${packages.size} packages: ${Object.keys(dependencies).join(", ")}`);

// 4. Install production dependencies (also produces package-lock.json for `npm ci` in Cloud Build).
execSync("npm install --omit=dev --no-audit --no-fund --loglevel=error", { cwd: outDir, stdio: "inherit" });
console.log("[build-functions] build/functions is ready.");
