import { describe, expect, it, mock } from "bun:test";
import { fetchComposeYml } from "./templates";

describe("fetchComposeYml", () => {
  it("falls back to the embedded compose template when the network fetch fails", async () => {
    const originalFetch = globalThis.fetch;
    const fetchMock = mock(() => Promise.reject(new Error("network down")));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      const compose = await fetchComposeYml();

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(compose).toContain("services:");
      expect(compose).toContain("daoflow:");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
