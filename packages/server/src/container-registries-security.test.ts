import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { makeSession } from "./testing/request-auth-fixtures";
import { TRPCError } from "@trpc/server";

describe("container registry security surfaces", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("blocks non-admin users from reading saved container registries", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-container-registries-forbidden",
      session: makeSession("viewer")
    });

    await expect(caller.containerRegistries()).rejects.toMatchObject({
      code: "FORBIDDEN"
    } satisfies Partial<TRPCError>);
  });
});
