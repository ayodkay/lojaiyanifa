// Cookie preferences (LGPD; Política de Cookies). Today the store uses only essential cookies and browser storage, so
// nothing depends on consent yet; analytics or marketing tools added later must check hasConsent() before loading
// (owner decision needed first, and the privacy and cookie policies must be updated — see docs/architecture.md).
// The choice lives in this browser only (localStorage), like the cart.
import { useSyncExternalStore } from "react";

export const CONSENT_KEY = "li.consent.v1";
/** Raise when the categories or their meaning change: everyone is asked again. */
export const CONSENT_VERSION = 1;

export type ConsentCategory = "analytics" | "marketing";

export interface ConsentState {
  analytics: boolean;
  marketing: boolean;
  /** When the visitor decided (ISO). */
  decidedAt: string;
  version: number;
}

/** A stored choice, or null when there is none, it is unreadable, or it is from an older version. */
export function parseConsent(raw: string | null): ConsentState | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<ConsentState>;
    if (value.version !== CONSENT_VERSION || typeof value.analytics !== "boolean" || typeof value.marketing !== "boolean" || typeof value.decidedAt !== "string") return null;
    return { analytics: value.analytics, marketing: value.marketing, decidedAt: value.decidedAt, version: value.version };
  } catch {
    return null;
  }
}

let snapshot: ConsentState | null | undefined;
const listeners = new Set<() => void>();

function read(): ConsentState | null {
  if (snapshot === undefined) {
    try {
      snapshot = parseConsent(window.localStorage.getItem(CONSENT_KEY));
    } catch {
      snapshot = null; // storage blocked: ask again each visit, never assume consent
    }
  }
  return snapshot;
}

export function saveConsent(choice: { analytics: boolean; marketing: boolean }, now = new Date()): ConsentState {
  const state: ConsentState = { ...choice, decidedAt: now.toISOString(), version: CONSENT_VERSION };
  snapshot = state;
  try {
    window.localStorage.setItem(CONSENT_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn("[consent] could not keep the choice in this browser", error);
  }
  for (const listener of listeners) listener();
  return state;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key !== CONSENT_KEY) return;
    snapshot = parseConsent(event.newValue);
    listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The visitor's choice (null on the server and until they decide). */
export const useConsent = () => useSyncExternalStore(subscribe, read, () => null);

/** Whether a non-essential category may run. Without a decision: no. */
export const hasConsent = (category: ConsentCategory): boolean => read()?.[category] === true;

/** Opens the preferences dialog from anywhere (the footer link). */
export const OPEN_CONSENT_EVENT = "li:open-consent";
export const openConsentPreferences = () => window.dispatchEvent(new Event(OPEN_CONSENT_EVENT));
