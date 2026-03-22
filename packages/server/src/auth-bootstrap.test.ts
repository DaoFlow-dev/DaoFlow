import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { resetInitialOwnerBootstrapState } from "./bootstrap-initial-owner";
import { resetControlPlaneSeedState } from "./db/services/seed";
import { resetTestDatabase } from "./test-db";

describe("auth bootstrap behavior", () => {
  it("assigns owner to the first manual signup when no bootstrap env is configured", async () => {
    const originalEmail = process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
    const originalPassword = process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
    delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
    delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;

    try {
      await resetTestDatabase();
      resetControlPlaneSeedState();
      resetInitialOwnerBootstrapState();

      const app = createApp();
      const ownerEmail = `owner+${Date.now()}@daoflow.local`;
      const response = await app.request("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "http://localhost:5173"
        },
        body: JSON.stringify({
          email: ownerEmail,
          name: "DaoFlow Owner",
          password: "secret1234"
        })
      });

      const body = (await response.json()) as {
        user: {
          email: string;
          role: string;
        };
      };

      expect(response.status).toBe(200);
      expect(body.user.email).toBe(ownerEmail);
      expect(body.user.role).toBe("owner");
    } finally {
      if (originalEmail !== undefined) {
        process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = originalEmail;
      } else {
        delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
      }

      if (originalPassword !== undefined) {
        process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = originalPassword;
      } else {
        delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
      }

      resetInitialOwnerBootstrapState();
    }
  });
});
