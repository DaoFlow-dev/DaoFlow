import { describe, expect, it } from "vitest";
import {
  agentTokenPresetNames,
  agentTokenPresets,
  getAgentTokenPresetDefinition,
  getAgentTokenPresetScopes,
  getApiTokenScopeLane,
  getEffectiveTokenCapabilities,
  isAgentTokenPreset,
  listAgentTokenPresets,
  roleCapabilities,
  type AgentTokenPreset,
  type ApiTokenScope
} from "@daoflow/shared";

// ─── Preset validation helpers ───────────────────────────────

function getCommandLaneScopes(scopes: readonly ApiTokenScope[]): ApiTokenScope[] {
  return scopes.filter((s) => getApiTokenScopeLane(s) === "command");
}

const ADMIN_ONLY_SCOPES: ApiTokenScope[] = [
  "terminal:open",
  "policy:override",
  "members:manage",
  "tokens:manage"
];

// ─── Tests ───────────────────────────────────────────────────

describe("agent token presets", () => {
  it("defines exactly three presets", () => {
    expect(agentTokenPresetNames).toHaveLength(3);
    expect(agentTokenPresetNames).toEqual(["agent:read-only", "agent:minimal-write", "agent:full"]);
  });

  describe("isAgentTokenPreset guard", () => {
    it("returns true for valid preset names", () => {
      for (const name of agentTokenPresetNames) {
        expect(isAgentTokenPreset(name)).toBe(true);
      }
    });

    it("returns false for invalid values", () => {
      expect(isAgentTokenPreset("agent:admin")).toBe(false);
      expect(isAgentTokenPreset("read-only")).toBe(false);
      expect(isAgentTokenPreset("")).toBe(false);
      expect(isAgentTokenPreset(null)).toBe(false);
      expect(isAgentTokenPreset(42)).toBe(false);
    });
  });

  describe("getAgentTokenPresetScopes", () => {
    it("returns scope arrays for all valid presets", () => {
      for (const name of agentTokenPresetNames) {
        const scopes = getAgentTokenPresetScopes(name);
        expect(scopes).toBeDefined();
        expect(Array.isArray(scopes)).toBe(true);
        expect(scopes!.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getAgentTokenPresetDefinition", () => {
    it("returns full definitions with required fields", () => {
      for (const name of agentTokenPresetNames) {
        const def = getAgentTokenPresetDefinition(name);
        expect(def).toBeDefined();
        expect(def!.name).toBe(name);
        expect(def!.label).toBeTruthy();
        expect(def!.description).toBeTruthy();
        expect(def!.scopes.length).toBeGreaterThan(0);
        expect(def!.lanes.length).toBeGreaterThan(0);
      }
    });
  });

  describe("listAgentTokenPresets", () => {
    it("returns all presets in order", () => {
      const presets = listAgentTokenPresets();
      expect(presets).toHaveLength(3);
      expect(presets[0].name).toBe("agent:read-only");
      expect(presets[1].name).toBe("agent:minimal-write");
      expect(presets[2].name).toBe("agent:full");
    });
  });

  // ─── Preset-specific tests ───────────────────────────────

  describe("agent:read-only preset", () => {
    const scopes = agentTokenPresets["agent:read-only"].scopes;

    it("has zero command-lane scopes", () => {
      expect(getCommandLaneScopes(scopes)).toEqual([]);
    });

    it("includes core observability scopes", () => {
      expect(scopes).toContain("server:read");
      expect(scopes).toContain("deploy:read");
      expect(scopes).toContain("logs:read");
      expect(scopes).toContain("events:read");
      expect(scopes).toContain("diagnostics:read");
    });

    it("only has read-lane scopes", () => {
      const def = agentTokenPresets["agent:read-only"];
      expect(def.lanes).toEqual(["read"]);
    });
  });

  describe("agent:minimal-write preset", () => {
    const scopes = agentTokenPresets["agent:minimal-write"].scopes;

    it("includes all read-only scopes", () => {
      const readOnlyScopes = agentTokenPresets["agent:read-only"].scopes;
      for (const scope of readOnlyScopes) {
        expect(scopes).toContain(scope);
      }
    });

    it("can deploy and rollback", () => {
      expect(scopes).toContain("deploy:start");
      expect(scopes).toContain("deploy:rollback");
    });

    it("can write env vars and secrets", () => {
      expect(scopes).toContain("env:write");
      expect(scopes).toContain("secrets:write");
    });

    it("can create approvals", () => {
      expect(scopes).toContain("approvals:create");
    });

    it("cannot modify servers or volumes", () => {
      expect(scopes).not.toContain("server:write");
      expect(scopes).not.toContain("volumes:write");
    });
  });

  describe("agent:full preset", () => {
    const scopes = agentTokenPresets["agent:full"].scopes;

    it("includes all minimal-write scopes", () => {
      const minimalWriteScopes = agentTokenPresets["agent:minimal-write"].scopes;
      for (const scope of minimalWriteScopes) {
        expect(scopes).toContain(scope);
      }
    });

    it("includes server and volume write", () => {
      expect(scopes).toContain("server:write");
      expect(scopes).toContain("service:update");
      expect(scopes).toContain("volumes:write");
    });

    it("includes backup operations", () => {
      expect(scopes).toContain("backup:run");
      expect(scopes).toContain("backup:restore");
    });

    it("excludes admin-only scopes (security boundary)", () => {
      for (const scope of ADMIN_ONLY_SCOPES) {
        expect(scopes).not.toContain(scope);
      }
    });
  });

  // ─── Cross-preset safety invariants ────────────────────────

  describe("security invariants", () => {
    it("no preset grants terminal:open", () => {
      for (const name of agentTokenPresetNames) {
        expect(agentTokenPresets[name].scopes).not.toContain("terminal:open");
      }
    });

    it("no preset grants policy:override", () => {
      for (const name of agentTokenPresetNames) {
        expect(agentTokenPresets[name].scopes).not.toContain("policy:override");
      }
    });

    it("no preset grants members:manage or tokens:manage", () => {
      for (const name of agentTokenPresetNames) {
        expect(agentTokenPresets[name].scopes).not.toContain("members:manage");
        expect(agentTokenPresets[name].scopes).not.toContain("tokens:manage");
      }
    });

    it("all preset scopes are subsets of owner role capabilities", () => {
      const ownerScopes = new Set(roleCapabilities.owner);
      for (const name of agentTokenPresetNames) {
        for (const scope of agentTokenPresets[name].scopes) {
          expect(ownerScopes.has(scope)).toBe(true);
        }
      }
    });

    it("presets are hierarchical: read-only ⊂ minimal-write ⊂ full", () => {
      const readOnly = new Set(agentTokenPresets["agent:read-only"].scopes);
      const minimalWrite = new Set(agentTokenPresets["agent:minimal-write"].scopes);
      const full = new Set(agentTokenPresets["agent:full"].scopes);

      // read-only ⊂ minimal-write
      for (const scope of readOnly) {
        expect(minimalWrite.has(scope)).toBe(true);
      }
      expect(minimalWrite.size).toBeGreaterThan(readOnly.size);

      // minimal-write ⊂ full
      for (const scope of minimalWrite) {
        expect(full.has(scope)).toBe(true);
      }
      expect(full.size).toBeGreaterThan(minimalWrite.size);
    });

    it("all preset scopes are subsets of agent role capabilities (ceiling check)", () => {
      const agentCeiling = new Set(roleCapabilities.agent);
      for (const name of agentTokenPresetNames) {
        for (const scope of agentTokenPresets[name].scopes) {
          expect(agentCeiling.has(scope)).toBe(true);
        }
      }
    });

    it("getEffectiveTokenCapabilities preserves all preset scopes for agent role", () => {
      // This is the critical test: ensure RBAC intersection does NOT
      // silently strip write scopes from agent tokens
      for (const name of agentTokenPresetNames) {
        const presetScopes = agentTokenPresets[name].scopes;
        const effective = getEffectiveTokenCapabilities("agent", presetScopes);

        // Every preset scope must survive the intersection
        expect(effective).toHaveLength(presetScopes.length);
        for (const scope of presetScopes) {
          expect(effective).toContain(scope);
        }
      }
    });
  });
});
