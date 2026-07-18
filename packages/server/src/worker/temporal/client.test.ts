import { describe, expect, it } from "vitest";
import { DEPLOYMENT_WORKFLOW_EXECUTION_TIMEOUT } from "./client";

describe("Temporal deployment client", () => {
  it("keeps the workflow alive beyond the activity and deployment execution deadlines", () => {
    expect(DEPLOYMENT_WORKFLOW_EXECUTION_TIMEOUT).toBe("7 days");
  });
});
