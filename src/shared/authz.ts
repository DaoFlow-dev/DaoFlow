export const appRoles = [
  "owner",
  "admin",
  "operator",
  "developer",
  "viewer",
  "agent"
] as const;

export type AppRole = (typeof appRoles)[number];

export const bootstrapOwnerRole: AppRole = "owner";
export const defaultSignupRole: AppRole = "viewer";

export const roleCapabilities: Record<AppRole, readonly string[]> = {
  owner: [
    "read.projects",
    "read.deployments",
    "read.logs",
    "deploy.execute",
    "backup.manage",
    "members.manage",
    "roles.manage",
    "tokens.manage",
    "servers.manage",
    "agents.plan",
    "agents.execute"
  ],
  admin: [
    "read.projects",
    "read.deployments",
    "read.logs",
    "deploy.execute",
    "backup.manage",
    "members.manage",
    "roles.manage",
    "tokens.manage",
    "servers.manage",
    "agents.plan"
  ],
  operator: [
    "read.projects",
    "read.deployments",
    "read.logs",
    "deploy.execute",
    "backup.manage",
    "servers.manage",
    "agents.plan"
  ],
  developer: [
    "read.projects",
    "read.deployments",
    "read.logs",
    "deploy.execute",
    "agents.plan"
  ],
  viewer: [
    "read.projects",
    "read.deployments",
    "read.logs"
  ],
  agent: [
    "read.projects",
    "read.deployments",
    "read.logs",
    "agents.plan"
  ]
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && appRoles.includes(value as AppRole);
}

export function normalizeAppRole(value: unknown): AppRole {
  return isAppRole(value) ? value : defaultSignupRole;
}

export function canAssumeAnyRole(role: AppRole, allowedRoles: readonly AppRole[]) {
  return allowedRoles.includes(role);
}
