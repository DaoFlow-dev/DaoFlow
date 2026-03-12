import { TRPCError } from "@trpc/server";
import { describe, expect, it } from "vitest";
import { appRouter } from "./router";

describe("appRouter", () => {
  it("returns a healthy status payload", async () => {
    const caller = appRouter.createCaller({ requestId: "test-health", session: null });
    const response = await caller.health();

    expect(response.status).toBe("healthy");
    expect(response.service).toBe("daoflow-control-plane");
  });

  it("filters roadmap items by lane", async () => {
    const caller = appRouter.createCaller({ requestId: "test-roadmap", session: null });
    const response = await caller.roadmap({ lane: "agent-safety" });

    expect(response).toHaveLength(1);
    expect(response[0]?.lane).toBe("agent-safety");
  });

  it("rejects protected procedures without a session", async () => {
    const caller = appRouter.createCaller({ requestId: "test-viewer", session: null });

    await expect(caller.viewer()).rejects.toBeInstanceOf(TRPCError);
  });

  it("returns viewer data for an authenticated session", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-viewer-ok",
      session: {
        user: {
          id: "user_123",
          email: "operator@daoflow.local",
          name: "DaoFlow Operator",
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
          image: null
        },
        session: {
          id: "session_123",
          userId: "user_123",
          expiresAt: new Date(),
          token: "token_123",
          createdAt: new Date(),
          updatedAt: new Date(),
          ipAddress: null,
          userAgent: null
        }
      }
    });

    const response = await caller.viewer();
    expect(response.user.email).toBe("operator@daoflow.local");
  });
});
