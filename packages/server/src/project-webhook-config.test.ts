import { describe, expect, it } from "vitest";
import { resetSeededTestDatabase } from "./test-db";
import { createProject, updateProject } from "./db/services/projects";
import { readWebhookAutoDeployConfig } from "./webhook-auto-deploy";

describe("project webhook auto-deploy config", () => {
  it("persists watched path filters and auto-deploy settings through project mutations", async () => {
    await resetSeededTestDatabase();

    const created = await createProject({
      name: `Webhook Config ${Date.now()}`,
      repoUrl: "https://github.com/example/project-webhook-config",
      teamId: "team_foundation",
      autoDeploy: true,
      autoDeployBranch: "release",
      webhookWatchedPaths: ["deploy/**", "./ops/*.yaml"],
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(created.status).toBe("ok");
    if (created.status !== "ok") {
      throw new Error("Failed to create project webhook config fixture.");
    }

    expect(created.project.autoDeploy).toBe(true);
    expect(created.project.autoDeployBranch).toBe("release");
    expect(readWebhookAutoDeployConfig(created.project.config)).toEqual({
      watchedPaths: ["deploy/**", "ops/*.yaml"]
    });

    const updated = await updateProject({
      projectId: created.project.id,
      autoDeploy: false,
      autoDeployBranch: "main",
      webhookWatchedPaths: [],
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });

    expect(updated.status).toBe("ok");
    if (updated.status !== "ok") {
      throw new Error("Failed to update project webhook config fixture.");
    }

    expect(updated.project.autoDeploy).toBe(false);
    expect(updated.project.autoDeployBranch).toBe("main");
    expect(readWebhookAutoDeployConfig(updated.project.config)).toEqual({
      watchedPaths: []
    });
  });
});
