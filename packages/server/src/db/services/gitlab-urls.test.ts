import { describe, expect, it } from "vitest";
import {
  buildGitLabApiBaseUrl,
  normalizeGitLabBaseUrl,
  resolveGitLabApiBaseUrl,
  resolveGitLabCloneBaseUrl,
  resolveGitLabPublicBaseUrl
} from "./gitlab-urls";

describe("GitLab URL routing", () => {
  it("normalizes public and internal path prefixes independently", () => {
    const provider = {
      baseUrl: "https://gitlab.public.example.com/gitlab/",
      internalBaseUrl: "http://gitlab.internal.example.com:8080/gitlab/"
    };

    expect(resolveGitLabPublicBaseUrl(provider)).toBe("https://gitlab.public.example.com/gitlab");
    expect(resolveGitLabCloneBaseUrl(provider)).toBe(
      "http://gitlab.internal.example.com:8080/gitlab"
    );
    expect(resolveGitLabApiBaseUrl(provider)).toBe(
      "http://gitlab.internal.example.com:8080/gitlab/api/v4"
    );
    expect(buildGitLabApiBaseUrl("https://gitlab.example.com/api/v4")).toBe(
      "https://gitlab.example.com/api/v4"
    );
  });

  it("rejects unsafe base URLs without disabling TLS verification", () => {
    for (const value of [
      "ftp://gitlab.example.com",
      "https://user:password@gitlab.example.com",
      "https://gitlab.example.com/gitlab?token=secret",
      "https://gitlab.example.com/gitlab#fragment"
    ]) {
      expect(() => normalizeGitLabBaseUrl(value)).toThrow();
    }
  });
});
