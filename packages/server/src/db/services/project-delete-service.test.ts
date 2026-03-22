import { beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";

const { cleanupProjectRuntimeMock } = vi.hoisted(() => ({
  cleanupProjectRuntimeMock: vi.fn()
}));

vi.mock("./project-runtime-cleanup", () => {
  return {
    cleanupProjectRuntime: cleanupProjectRuntimeMock
  };
});

import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects } from "../schema/projects";
import { resetSeededTestDatabase } from "../../test-db";
import { createProject } from "./projects";
import { deleteProject } from "./project-delete-service";

const actor = {
  teamId: "team_foundation",
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

async function createProjectFixture() {
  const result = await createProject({
    name: `delete-project-fixture-${Date.now()}`,
    description: "Delete project test fixture",
    ...actor
  });
  if (result.status !== "ok") {
    throw new Error("Failed to create project fixture.");
  }

  return result.project;
}

describe("deleteProject", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    cleanupProjectRuntimeMock.mockReset();
  });

  it("refuses to delete the project when runtime cleanup fails", async () => {
    const project = await createProjectFixture();
    cleanupProjectRuntimeMock.mockResolvedValue({
      status: "cleanup_failed",
      message: "Failed to clean runtime demo on foundation-vps-1: ssh timeout"
    });

    const result = await deleteProject({
      projectId: project.id,
      ...actor
    });

    expect(result).toEqual({
      status: "runtime_cleanup_failed",
      message: "Failed to clean runtime demo on foundation-vps-1: ssh timeout"
    });

    const [storedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1);
    expect(storedProject?.id).toBe(project.id);
  });

  it("records runtime cleanup metadata when deletion succeeds", async () => {
    const project = await createProjectFixture();
    cleanupProjectRuntimeMock.mockResolvedValue({
      status: "ok",
      cleanedTargets: 2
    });

    const result = await deleteProject({
      projectId: project.id,
      ...actor
    });

    expect(result).toEqual({ status: "ok" });

    const [storedProject] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, project.id))
      .limit(1);
    expect(storedProject).toBeUndefined();

    const [auditEntry] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `project/${project.id}`),
          eq(auditEntries.action, "project.delete")
        )
      )
      .limit(1);
    expect(auditEntry?.metadata).toMatchObject({
      resourceType: "project",
      resourceId: project.id,
      runtimeCleanup: {
        status: "ok",
        cleanedTargets: 2
      }
    });
  });
});
