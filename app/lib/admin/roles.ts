// Admin roles and what each may do (docs/architecture.md §3). Roles are
// Firebase Auth custom claims (`role`), set only with the Admin SDK
// (scripts/admin/grant-role.mjs); customers have no role. Shared by the server,
// which enforces it, and the admin pages, which hide what a role can't use.
export const ADMIN_ROLES = ["owner", "admin", "staff"] as const;
export type AdminRole = (typeof ADMIN_ROLES)[number];

export const isAdminRole = (value: unknown): value is AdminRole =>
  typeof value === "string" && (ADMIN_ROLES as readonly string[]).includes(value);

export const ROLE_LABEL: Record<AdminRole, string> = {
  owner: "Proprietário(a)",
  admin: "Administrador(a)",
  staff: "Equipe",
};

/** Only capabilities that exist in the admin today; add rows as features land. */
export type Capability = "orders.view" | "orders.confirm_payment" | "orders.cancel" | "orders.fulfill" | "orders.add_note" | "orders.refund";

const ALLOWED: Record<Capability, readonly AdminRole[]> = {
  "orders.view": ["owner", "admin", "staff"],
  "orders.confirm_payment": ["owner", "admin", "staff"],
  // Cancelling gives stock back and ends the sale: owner and admin only.
  "orders.cancel": ["owner", "admin"],
  // Preparing, shipping and handing over orders, tracking codes, internal notes: the whole team.
  "orders.fulfill": ["owner", "admin", "staff"],
  "orders.add_note": ["owner", "admin", "staff"],
  // Recording a refund changes the money and the stock: owner and admin only (like cancelling).
  "orders.refund": ["owner", "admin"],
};

export function can(role: AdminRole, capability: Capability): boolean {
  return ALLOWED[capability].includes(role);
}
