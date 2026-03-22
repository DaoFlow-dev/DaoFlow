import { describe, expect, it } from "vitest";

describe("deploy-strategies barrel", () => {
  it("re-exports executeComposeDeployment from compose-deploy-strategy", async () => {
    const [barrel, strategy] = await Promise.all([
      import("./deploy-strategies"),
      import("./compose-deploy-strategy")
    ]);

    expect(barrel.executeComposeDeployment).toBe(strategy.executeComposeDeployment);
  });
});
