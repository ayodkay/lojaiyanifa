/** Lowercase and strip diacritics: "Búzios Ifá" → "buzios ifa". For search and matching. */
export function fold(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

/** Splits comma/semicolon separated editorial lists into trimmed, non-empty items. */
export function splitList(value: string | null | undefined): string[] {
  if (!value) return [];
  return value
    .split(/[,;\n]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

/** True if the text contains U+FFFD, the marker of a broken text encoding. */
export function hasReplacementChar(value: string | null | undefined): boolean {
  return Boolean(value?.includes("�"));
}
