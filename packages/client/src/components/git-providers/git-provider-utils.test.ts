import { describe, expect, it } from "vitest";
import { buildGitHubManifest } from "./git-provider-utils";

describe("buildGitHubManifest", () => {
  it("requests deployment updates without dropping pull-request write access", () => {
    const manifest = buildGitHubManifest(
      "https://daoflow.example.test",
      "https://daoflow.example.test"
    );

    expect(manifest.default_permissions).toMatchObject({
      deployments: "write",
      pull_requests: "write"
    });
    expect(Object.keys(manifest.default_permissions)).toEqual(
      expect.arrayContaining(["contents", "metadata", "emails", "deployments", "pull_requests"])
    );
  });
});
