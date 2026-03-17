// ─── Roles ───────────────────────────────────────────────────
export const appRoles = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

export type AppRole = (typeof appRoles)[number];

export const bootstrapOwnerRole: AppRole = "owner";
export const defaultSignupRole: AppRole = "viewer";

// ─── Guard Functions ─────────────────────────────────────────

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && appRoles.includes(value as AppRole);
}

export function normalizeAppRole(value: unknown): AppRole {
  return isAppRole(value) ? value : defaultSignupRole;
}

export function canAssumeAnyRole(role: AppRole, allowedRoles: readonly AppRole[]) {
  return allowedRoles.includes(role);
}
