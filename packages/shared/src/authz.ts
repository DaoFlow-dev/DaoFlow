export const appRoles = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

export type AppRole = (typeof appRoles)[number];

export const apiTokenScopeLanes = ["read", "planning", "command"] as const;

export type ApiTokenScopeLane = (typeof apiTokenScopeLanes)[number];

export const apiTokenScopes = [
  "read.projects",
  "read.deployments",
  "read.logs",
  "agents.plan",
  "deploy.execute",
  "backup.manage",
  "members.manage",
  "roles.manage",
  "tokens.manage",
  "servers.manage",
  "agents.execute"
] as const;

export type ApiTokenScope = (typeof apiTokenScopes)[number];

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
  developer: ["read.projects", "read.deployments", "read.logs", "deploy.execute", "agents.plan"],
  viewer: ["read.projects", "read.deployments", "read.logs"],
  agent: ["read.projects", "read.deployments", "read.logs", "agents.plan"]
};

const apiTokenScopeLaneMap: Record<ApiTokenScope, ApiTokenScopeLane> = {
  "read.projects": "read",
  "read.deployments": "read",
  "read.logs": "read",
  "agents.plan": "planning",
  "deploy.execute": "command",
  "backup.manage": "command",
  "members.manage": "command",
  "roles.manage": "command",
  "tokens.manage": "command",
  "servers.manage": "command",
  "agents.execute": "command"
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === "string" && appRoles.includes(value as AppRole);
}

export function isApiTokenScope(value: unknown): value is ApiTokenScope {
  return typeof value === "string" && apiTokenScopes.includes(value as ApiTokenScope);
}

export function normalizeAppRole(value: unknown): AppRole {
  return isAppRole(value) ? value : defaultSignupRole;
}

export function canAssumeAnyRole(role: AppRole, allowedRoles: readonly AppRole[]) {
  return allowedRoles.includes(role);
}

export function normalizeApiTokenScopes(scopes: readonly string[]) {
  const normalizedScopes: ApiTokenScope[] = [];

  for (const scope of scopes) {
    if (isApiTokenScope(scope) && !normalizedScopes.includes(scope)) {
      normalizedScopes.push(scope);
    }
  }

  return normalizedScopes;
}

export function getApiTokenScopeLane(scope: ApiTokenScope) {
  return apiTokenScopeLaneMap[scope];
}

export function getApiTokenScopeLanes(scopes: readonly string[]) {
  return Array.from(
    new Set(normalizeApiTokenScopes(scopes).map((scope) => getApiTokenScopeLane(scope)))
  );
}

export function getEffectiveTokenCapabilities(role: AppRole, scopes: readonly string[]) {
  const grantedScopes = new Set(normalizeApiTokenScopes(scopes));

  return roleCapabilities[role].filter((capability) =>
    grantedScopes.has(capability as ApiTokenScope)
  );
}
