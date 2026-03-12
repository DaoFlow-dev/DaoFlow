import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";

describe("createApp", () => {
  it("serves the health endpoint with security and request metadata", async () => {
    const app = createApp();
    const response = await request(app).get("/health");
    const body = response.body as {
      requestId: string;
      status: string;
    };

    expect(response.status).toBe(200);
    expect(body.status).toBe("healthy");
    expect(body.requestId).toMatch(/^req-/);
    expect(response.headers["x-request-id"]).toMatch(/^req-/);
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("mounts the tRPC HTTP endpoint", async () => {
    const app = createApp();
    const response = await request(app).get("/trpc/health");
    const body = response.body as {
      result: {
        data: {
          status: string;
        };
      };
    };

    expect(response.status).toBe(200);
    expect(body.result.data.status).toBe("healthy");
  });

  it("mounts Better Auth with durable schema bootstrap", async () => {
    const app = createApp();
    const email = `operator+${Date.now()}@daoflow.local`;
    const response = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", "http://localhost:5173")
      .send({
        email,
        name: "DaoFlow Operator",
        password: "secret1234"
      });
    const body = response.body as {
      user: {
        email: string;
      };
    };

    expect(response.status).toBe(200);
    expect(body.user.email).toBe(email);
    expect(response.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("better-auth.session_token")])
    );
  });
});
