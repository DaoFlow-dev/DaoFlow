// ─── Roles ───────────────────────────────────────────────────
export const appRoles = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

export type AppRole = (typeof appRoles)[number];

export const bootstrapOwnerRole: AppRole = "owner";
export const defaultSignupRole: AppRole = "viewer";

// ─── Token Scope Lanes ───────────────────────────────────────
export const apiTokenScopeLanes = ["read", "planning", "command"] as const;

export type ApiTokenScopeLane = (typeof apiTokenScopeLanes)[number];

// ─── Scopes (colon-delimited, matches AGENTS.md §11) ────────
export const apiTokenScopes = [
  // Infrastructure
  "server:read",
  "server:write",
  // Deployment
  "deploy:read",
  "deploy:start",
  "deploy:cancel",
  "deploy:rollback",
  "service:read",
  "service:update",
  // Data & Secrets
  "env:read",
  "env:write",
  "secrets:read",
  "secrets:write",
  "volumes:read",
  "volumes:write",
  "backup:read",
  "backup:run",
  "backup:restore",
  // Observability
  "logs:read",
  "events:read",
  "diagnostics:read",
  // Administration
  "members:manage",
  "tokens:manage",
  "approvals:create",
  "approvals:decide",
  "terminal:open",
  "policy:override"
] as const;

export type ApiTokenScope = (typeof apiTokenScopes)[number];

// ─── Lane mapping ────────────────────────────────────────────
const apiTokenScopeLaneMap: Record<ApiTokenScope, ApiTokenScopeLane> = {
  "server:read": "read",
  "server:write": "command",
  "deploy:read": "read",
  "deploy:start": "command",
  "deploy:cancel": "command",
  "deploy:rollback": "command",
  "service:read": "read",
  "service:update": "command",
  "env:read": "read",
  "env:write": "command",
  "secrets:read": "read",
  "secrets:write": "command",
  "volumes:read": "read",
  "volumes:write": "command",
  "backup:read": "read",
  "backup:run": "command",
  "backup:restore": "command",
  "logs:read": "read",
  "events:read": "read",
  "diagnostics:read": "read",
  "members:manage": "command",
  "tokens:manage": "command",
  "approvals:create": "planning",
  "approvals:decide": "command",
  "terminal:open": "command",
  "policy:override": "command"
};

// ─── Role → Capabilities ─────────────────────────────────────
export const roleCapabilities: Record<AppRole, readonly ApiTokenScope[]> = {
  owner: [
    "server:read",
    "server:write",
    "deploy:read",
    "deploy:start",
    "deploy:cancel",
    "deploy:rollback",
    "service:read",
    "service:update",
    "env:read",
    "env:write",
    "secrets:read",
    "secrets:write",
    "volumes:read",
    "volumes:write",
    "backup:read",
    "backup:run",
    "backup:restore",
    "logs:read",
    "events:read",
    "diagnostics:read",
    "members:manage",
    "tokens:manage",
    "approvals:create",
    "approvals:decide",
    "terminal:open",
    "policy:override"
  ],
  admin: [
    "server:read",
    "server:write",
    "deploy:read",
    "deploy:start",
    "deploy:cancel",
    "deploy:rollback",
    "service:read",
    "service:update",
    "env:read",
    "env:write",
    "secrets:read",
    "secrets:write",
    "volumes:read",
    "volumes:write",
    "backup:read",
    "backup:run",
    "backup:restore",
    "logs:read",
    "events:read",
    "diagnostics:read",
    "members:manage",
    "tokens:manage",
    "approvals:create",
    "approvals:decide"
  ],
  operator: [
    "server:read",
    "server:write",
    "deploy:read",
    "deploy:start",
    "deploy:cancel",
    "deploy:rollback",
    "service:read",
    "service:update",
    "env:read",
    "env:write",
    "volumes:read",
    "volumes:write",
    "backup:read",
    "backup:run",
    "backup:restore",
    "logs:read",
    "events:read",
    "diagnostics:read",
    "approvals:create",
    "approvals:decide"
  ],
  developer: [
    "server:read",
    "deploy:read",
    "deploy:start",
    "service:read",
    "env:read",
    "env:write",
    "volumes:read",
    "backup:read",
    "logs:read",
    "events:read",
    "approvals:create"
  ],
  viewer: [
    "server:read",
    "deploy:read",
    "service:read",
    "env:read",
    "volumes:read",
    "backup:read",
    "logs:read",
    "events:read"
  ],
  agent: [
    "server:read",
    "deploy:read",
    "service:read",
    "env:read",
    "volumes:read",
    "backup:read",
    "logs:read",
    "events:read",
    "diagnostics:read",
    "approvals:create"
  ]
};

// ─── Guard Functions ─────────────────────────────────────────

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

/** Check if a set of scopes includes a single required scope. */
export function hasScope(grantedScopes: readonly string[], required: ApiTokenScope): boolean {
  return grantedScopes.includes(required);
}

/** Check if a set of scopes includes ALL of the required scopes. */
export function hasAllScopes(
  grantedScopes: readonly string[],
  required: readonly ApiTokenScope[]
): boolean {
  return required.every((s) => grantedScopes.includes(s));
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

  return roleCapabilities[role].filter((capability) => grantedScopes.has(capability));
}
