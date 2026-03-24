import { describe, expect, it } from "bun:test";
import { buildAuthHeaders } from "./auth-headers";

describe("buildAuthHeaders", () => {
  it("uses Bearer auth for DaoFlow API tokens", () => {
    expect(buildAuthHeaders("dfl_test_token_123")).toEqual({
      Authorization: "Bearer dfl_test_token_123"
    });
  });

  it("uses Better Auth session cookies for non-DaoFlow tokens", () => {
    expect(buildAuthHeaders("session_token_123")).toEqual({
      Cookie:
        "better-auth.session_token=session_token_123; __Secure-better-auth.session_token=session_token_123"
    });
  });

  it("merges extra headers without dropping auth", () => {
    expect(
      buildAuthHeaders("dfl_test_token_123", {
        "Content-Type": "application/json"
      })
    ).toEqual({
      Authorization: "Bearer dfl_test_token_123",
      "Content-Type": "application/json"
    });
  });
});
