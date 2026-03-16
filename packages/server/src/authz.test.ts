import { describe, expect, it } from "vitest";
import {
  getApiTokenScopeLanes,
  getEffectiveTokenCapabilities,
  normalizeApiTokenScopes
} from "@daoflow/shared";

describe("authz token scopes", () => {
  it("normalizes duplicate and unknown token scopes", () => {
    expect(
      normalizeApiTokenScopes(["server:read", "unknown.scope", "server:read", "approvals:create"])
    ).toEqual(["server:read", "approvals:create"]);
  });

  it("intersects principal capabilities with token scopes", () => {
    expect(
      getEffectiveTokenCapabilities("operator", ["server:read", "deploy:start", "tokens:manage"])
    ).toEqual(["server:read", "deploy:start"]);
  });

  it("maps scopes into agent-safe API lanes", () => {
    expect(
      getApiTokenScopeLanes(["server:read", "logs:read", "approvals:create", "deploy:start"])
    ).toEqual(["read", "planning", "command"]);
  });
});
