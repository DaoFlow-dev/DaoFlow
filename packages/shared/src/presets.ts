import type { ApiTokenScope } from "./scopes";
import { getApiTokenScopeLanes } from "./scopes";
import type { ApiTokenScopeLane } from "./scopes";

// ─── Agent Token Presets ─────────────────────────────────────
//
// Named scope bundles for common agent use cases.
// Presets simplify token creation — pick a preset instead of
// cherry-picking 10+ individual scopes.
//
// Design principles (from AGENTS.md §11):
//   • Agents default to read-only
//   • Destructive actions require explicit elevated scopes
//   • No preset grants terminal:open or policy:override
//   • No preset grants members:manage or tokens:manage

export const agentTokenPresetNames = [
  "agent:read-only",
  "agent:minimal-write",
  "agent:full"
] as const;

export type AgentTokenPreset = (typeof agentTokenPresetNames)[number];

export interface AgentTokenPresetDefinition {
  /** Machine-readable preset key */
  readonly name: AgentTokenPreset;
  /** Human-readable label */
  readonly label: string;
  /** Short description for UI dropdowns and CLI help */
  readonly description: string;
  /** Scopes included in this preset */
  readonly scopes: readonly ApiTokenScope[];
  /** Which API lanes this preset enables */
  readonly lanes: readonly ApiTokenScopeLane[];
}

// ─── Read-Only ───────────────────────────────────────────────
// Safe for monitoring, diagnostics, and observability.
// Zero command-lane scopes — cannot mutate any infrastructure.

const readOnlyScopes: readonly ApiTokenScope[] = [
  "server:read",
  "deploy:read",
  "service:read",
  "env:read",
  "volumes:read",
  "backup:read",
  "logs:read",
  "events:read",
  "diagnostics:read"
] as const;

// ─── Minimal Write ───────────────────────────────────────────
// Suitable for CI/CD pipelines and limited operational tasks.
// Can deploy, rollback, and manage env vars + secrets, but
// cannot modify servers, volumes, backups, or admin settings.

const minimalWriteScopes: readonly ApiTokenScope[] = [
  // All read scopes
  ...readOnlyScopes,
  // Limited write: deploy + env/secrets
  "deploy:start",
  "deploy:rollback",
  "env:write",
  "secrets:write",
  "approvals:create"
] as const;

// ─── Full Agent ──────────────────────────────────────────────
// All operational scopes for a trusted agent. Still excludes
// admin-only scopes: terminal:open, policy:override,
// members:manage, tokens:manage.

const fullAgentScopes: readonly ApiTokenScope[] = [
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
  // Approvals
  "approvals:create",
  "approvals:decide"
] as const;

// ─── Preset Map ──────────────────────────────────────────────

export const agentTokenPresets: Record<AgentTokenPreset, AgentTokenPresetDefinition> = {
  "agent:read-only": {
    name: "agent:read-only",
    label: "Read-Only Agent",
    description:
      "Observe infrastructure, read logs, view deployments. Cannot mutate any resources.",
    scopes: readOnlyScopes,
    lanes: getApiTokenScopeLanes(readOnlyScopes) as ApiTokenScopeLane[]
  },
  "agent:minimal-write": {
    name: "agent:minimal-write",
    label: "Minimal Write Agent",
    description:
      "Deploy, rollback, and manage env vars/secrets. Cannot modify servers, volumes, or backups.",
    scopes: minimalWriteScopes,
    lanes: getApiTokenScopeLanes(minimalWriteScopes) as ApiTokenScopeLane[]
  },
  "agent:full": {
    name: "agent:full",
    label: "Full Agent",
    description:
      "All operational scopes. Cannot manage members, tokens, terminal access, or policy overrides.",
    scopes: fullAgentScopes,
    lanes: getApiTokenScopeLanes(fullAgentScopes) as ApiTokenScopeLane[]
  }
};

// ─── Guard & Utility Functions ───────────────────────────────

export function isAgentTokenPreset(value: unknown): value is AgentTokenPreset {
  return typeof value === "string" && agentTokenPresetNames.includes(value as AgentTokenPreset);
}

/** Get the scope array for a preset name. Returns undefined for invalid presets. */
export function getAgentTokenPresetScopes(
  preset: AgentTokenPreset
): readonly ApiTokenScope[] | undefined {
  return agentTokenPresets[preset]?.scopes;
}

/** Get the full preset definition. Returns undefined for invalid presets. */
export function getAgentTokenPresetDefinition(
  preset: AgentTokenPreset
): AgentTokenPresetDefinition | undefined {
  return agentTokenPresets[preset];
}

/** List all presets with their metadata (for CLI help and UI dropdowns). */
export function listAgentTokenPresets(): readonly AgentTokenPresetDefinition[] {
  return agentTokenPresetNames.map((name) => agentTokenPresets[name]);
}
