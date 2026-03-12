import { describe, expect, it } from "vitest";
import {
  getApiTokenScopeLanes,
  getEffectiveTokenCapabilities,
  normalizeApiTokenScopes
} from "./authz";

describe("authz token scopes", () => {
  it("normalizes duplicate and unknown token scopes", () => {
    expect(
      normalizeApiTokenScopes([
        "read.projects",
        "unknown.scope",
        "read.projects",
        "agents.plan"
      ])
    ).toEqual(["read.projects", "agents.plan"]);
  });

  it("intersects principal capabilities with token scopes", () => {
    expect(
      getEffectiveTokenCapabilities("operator", [
        "read.projects",
        "deploy.execute",
        "roles.manage"
      ])
    ).toEqual(["read.projects", "deploy.execute"]);
  });

  it("maps scopes into agent-safe API lanes", () => {
    expect(
      getApiTokenScopeLanes([
        "read.projects",
        "read.logs",
        "agents.plan",
        "deploy.execute"
      ])
    ).toEqual(["read", "planning", "command"]);
  });
});
