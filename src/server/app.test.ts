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
    const ownerEmail = `owner+${Date.now()}@daoflow.local`;
    const ownerResponse = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", "http://localhost:5173")
      .send({
        email: ownerEmail,
        name: "DaoFlow Operator",
        password: "secret1234"
      });
    const ownerBody = ownerResponse.body as {
      user: {
        email: string;
        role: string;
      };
    };
    const viewerEmail = `viewer+${Date.now()}@daoflow.local`;
    const viewerResponse = await request(app)
      .post("/api/auth/sign-up/email")
      .set("Origin", "http://localhost:5173")
      .send({
        email: viewerEmail,
        name: "DaoFlow Viewer",
        password: "secret1234"
      });
    const viewerBody = viewerResponse.body as {
      user: {
        email: string;
        role: string;
      };
    };

    expect(ownerResponse.status).toBe(200);
    expect(ownerBody.user.email).toBe(ownerEmail);
    expect(ownerBody.user.role).toBe("owner");
    expect(ownerResponse.headers["set-cookie"]).toEqual(
      expect.arrayContaining([expect.stringContaining("better-auth.session_token")])
    );
    expect(viewerResponse.status).toBe(200);
    expect(viewerBody.user.email).toBe(viewerEmail);
    expect(viewerBody.user.role).toBe("viewer");
  });
});
