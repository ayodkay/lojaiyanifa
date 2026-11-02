// Shared by scripts/admin/grant-role.mjs and scripts/dev/seed-emulator.mjs.
// Roles are the Firebase custom claim `role` (docs/architecture.md §3).
import { Timestamp } from "firebase-admin/firestore";

/** Keep in sync with ADMIN_ROLES in app/lib/admin/roles.ts. */
export const ROLES = ["owner", "admin", "staff"];

/**
 * Sets (or with role "none", removes) the account's role, then revokes its
 * sessions: a live session cookie keeps the claims it was minted with, so
 * without revocation a removed role would keep working for up to 12 hours.
 * Records the change in auditLogs.
 */
export async function setRole(auth, db, { email, role, by }) {
  if (role !== "none" && !ROLES.includes(role)) throw new Error(`Unknown role "${role}". Use one of: ${ROLES.join(", ")}, none.`);
  const user = await auth.getUserByEmail(email);
  const claims = { ...(user.customClaims ?? {}) };
  const before = claims.role ?? null;
  const after = role === "none" ? null : role;
  if (after === null) delete claims.role;
  else claims.role = after;

  await auth.setCustomUserClaims(user.uid, claims);
  await auth.revokeRefreshTokens(user.uid);
  await db.collection("auditLogs").doc().create({
    at: Timestamp.now(),
    action: "role.changed",
    actor: { type: "script", name: "grant-role", by },
    target: `users/${user.uid}`,
    details: { email: user.email, from: before, to: after },
  });
  return { uid: user.uid, before, after, emailVerified: user.emailVerified };
}
