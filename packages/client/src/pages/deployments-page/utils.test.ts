import { describe, expect, it } from "vitest";
import { matchesDeploymentFilters } from "./utils";

describe("deployment page filters", () => {
  it("keeps build-slot waiters in the queued filter", () => {
    expect(
      matchesDeploymentFilters(
        {
          id: "dep_waiting",
          serviceName: "web",
          status: "queued",
          lifecycleStatus: "waiting",
          statusLabel: "Waiting for build slot",
          statusTone: "queued"
        },
        "",
        "queued"
      )
    ).toBe(true);
  });
});
