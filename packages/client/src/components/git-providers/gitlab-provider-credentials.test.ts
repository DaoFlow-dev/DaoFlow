import { describe, expect, it } from "vitest";
import { hasNonOAuthGitLabInstallation } from "./gitlab-provider-credentials";

describe("hasNonOAuthGitLabInstallation", () => {
  it("treats current and legacy OAuth installations as connectable", () => {
    expect(
      hasNonOAuthGitLabInstallation([
        { credentialKind: "oauth" },
        { credentialKind: "legacy_oauth" }
      ])
    ).toBe(false);
    expect(hasNonOAuthGitLabInstallation([{ credentialKind: "deploy_token" }])).toBe(true);
  });
});
