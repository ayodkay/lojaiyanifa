// Helpers for tests that run against the Firebase emulators. The REST endpoints
// used here exist only in the emulators, so these can never wipe a real project.
export const TEST_PROJECT = "demo-lojaiyanifa";

export function emulatorHost(name: "FIRESTORE_EMULATOR_HOST" | "FIREBASE_AUTH_EMULATOR_HOST"): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set. Run integration tests with \`npm run test:integration\` (it starts the emulators).`);
  }
  return value;
}

async function emulatorDelete(url: string, what: string): Promise<void> {
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok) throw new Error(`${what} failed: HTTP ${res.status} ${await res.text()}`);
}

/** Deletes every document in the Firestore emulator. */
export function clearFirestore(): Promise<void> {
  return emulatorDelete(
    `http://${emulatorHost("FIRESTORE_EMULATOR_HOST")}/emulator/v1/projects/${TEST_PROJECT}/databases/(default)/documents`,
    "clearFirestore",
  );
}

/** Deletes every user in the Auth emulator. */
export function clearAuth(): Promise<void> {
  return emulatorDelete(
    `http://${emulatorHost("FIREBASE_AUTH_EMULATOR_HOST")}/emulator/v1/projects/${TEST_PROJECT}/accounts`,
    "clearAuth",
  );
}
