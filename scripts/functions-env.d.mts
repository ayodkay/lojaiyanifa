// Types for scripts/functions-env.mjs (imported by tests/unit/functions-env.test.ts).

/** Variables a production env file must set. */
export const REQUIRED: readonly string[];

/** Problems that keep a production env file from being deployed; empty when it can go. */
export function productionEnvProblems(text: string): string[];

/** The dev .env.local as the functions emulator can load it: lines whose names the Firebase CLI refuses are dropped. */
export function emulatorEnvFile(text: string): { text: string; dropped: string[] };
