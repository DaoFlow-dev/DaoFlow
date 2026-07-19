import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchWithProviderTimeout } from "./project-source-provider-validation-shared";

function requestTls(init: unknown): unknown {
  if (!init || typeof init !== "object" || !("tls" in init)) return undefined;
  return init.tls;
}

describe("provider validation transport", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps default fetch trust for providers without a custom CA", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      expect(requestTls(init)).toBeUndefined();
      return Promise.resolve(new Response("ok", { status: 200 }));
    });

    const response = await fetchWithProviderTimeout(
      { teamId: "team_foundation", caCertificateId: null },
      "gitlab",
      "repository access",
      "https://gitlab.com/api/v4/projects/example",
      { headers: { Accept: "application/json" } }
    );

    expect(response).toBeInstanceOf(Response);
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
