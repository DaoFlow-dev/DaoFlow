import { describe, expect, it } from "vitest";
import { buildPoolConfig } from "./connection";

describe("buildPoolConfig", () => {
  it("uses tighter pool settings for the single-worker test runtime", () => {
    expect(
      buildPoolConfig({
        connectionString: "postgresql://localhost:5432/daoflow_test",
        testRuntime: true
      })
    ).toMatchObject({
      connectionString: "postgresql://localhost:5432/daoflow_test",
      max: 8,
      idleTimeoutMillis: 1_000,
      connectionTimeoutMillis: 15_000,
      maxUses: 50
    });
  });

  it("preserves the production pool defaults outside tests", () => {
    expect(
      buildPoolConfig({
        connectionString: "postgresql://localhost:5432/daoflow",
        testRuntime: false
      })
    ).toMatchObject({
      connectionString: "postgresql://localhost:5432/daoflow",
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
  });
});
