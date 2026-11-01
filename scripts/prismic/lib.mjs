// Shared helpers for the Prismic model scripts (Custom Types API).
import { existsSync } from "node:fs";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

export const repo = process.env.PRISMIC_REPO;
const token = process.env.PRISMIC_WRITE_TOKEN;
const API = "https://customtypes.prismic.io";

if (!repo || !token) {
  console.error("Set PRISMIC_REPO and PRISMIC_WRITE_TOKEN first (in .env.local).");
  process.exit(1);
}

export async function api(path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      repository: repo,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json; charset=utf-8",
      ...init.headers,
    },
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${init.method ?? "GET"} ${path} → HTTP ${response.status}: ${text}`);
  }
  return text ? JSON.parse(text) : null;
}

// Stable stringify (sorted keys) so comparisons ignore key order.
export function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

// Flattens a custom type into { "Tab › field": definition } plus group sub-fields
// as "Tab › group › sub".
export function fieldMap(type) {
  const out = new Map();
  for (const [tab, fields] of Object.entries(type.json ?? {})) {
    for (const [key, def] of Object.entries(fields)) {
      const { fields: subFields, ...groupConfig } = def.config ?? {};
      if (def.type === "Group") {
        out.set(`${tab} › ${key}`, { ...def, config: groupConfig });
        for (const [sub, subDef] of Object.entries(subFields ?? {})) out.set(`${tab} › ${key} › ${sub}`, subDef);
      } else {
        out.set(`${tab} › ${key}`, def);
      }
    }
  }
  return out;
}
