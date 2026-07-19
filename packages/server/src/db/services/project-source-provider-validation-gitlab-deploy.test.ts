import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { validateGitLabDeployTokenSource } from "./project-source-provider-validation-gitlab-deploy";

describe("GitLab deploy-token source validation", () => {
  const workDirs: string[] = [];

  afterEach(() => {
    vi.restoreAllMocks();
    for (const workDir of workDirs.splice(0)) rmSync(workDir, { force: true, recursive: true });
  });

  it("validates branch materialization and compose files without calling the GitLab API", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-gitlab-deploy-"));
    workDirs.push(workDir);
    writeFileSync(join(workDir, "docker-compose.yml"), "services: {}\n");
    const fetchMock = vi.spyOn(globalThis, "fetch");

    const result = await validateGitLabDeployTokenSource(
      {
        teamId: "team_foundation",
        repoFullName: "example-group/platform",
        gitProviderId: "gitprov_deploy",
        gitInstallationId: "gitinst_deploy",
        defaultBranch: "main",
        composePath: "docker-compose.yml",
        composeFiles: ["docker-compose.yml"],
        composeProfiles: []
      },
      () => Promise.resolve({ status: "ok", workDir, cleanup: () => undefined })
    );

    expect(result).toMatchObject({ status: "ready" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("keeps compose-path validation inside the materialized checkout", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-gitlab-deploy-"));
    workDirs.push(workDir);

    const result = await validateGitLabDeployTokenSource(
      {
        teamId: "team_foundation",
        repoFullName: "example-group/platform",
        gitProviderId: "gitprov_deploy",
        gitInstallationId: "gitinst_deploy",
        defaultBranch: "main",
        composePath: "missing.yml",
        composeFiles: ["missing.yml"],
        composeProfiles: []
      },
      () => Promise.resolve({ status: "ok", workDir, cleanup: () => undefined })
    );

    expect(result).toMatchObject({
      status: "invalid",
      readiness: { checks: { repository: "ok", branch: "ok", composePath: "failed" } }
    });
  });

  it("rejects compose-file symlinks that escape the materialized checkout", async () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-gitlab-deploy-"));
    const outsideDir = mkdtempSync(join(tmpdir(), "daoflow-gitlab-deploy-outside-"));
    workDirs.push(workDir, outsideDir);
    const outsidePath = join(outsideDir, "compose.yaml");
    writeFileSync(outsidePath, "services: {}\n");
    symlinkSync(outsidePath, join(workDir, "compose.yaml"));

    const result = await validateGitLabDeployTokenSource(
      {
        teamId: "team_foundation",
        repoFullName: "example-group/platform",
        gitProviderId: "gitprov_deploy",
        gitInstallationId: "gitinst_deploy",
        defaultBranch: "main",
        composePath: "compose.yaml",
        composeFiles: ["compose.yaml"],
        composeProfiles: []
      },
      () => Promise.resolve({ status: "ok", workDir, cleanup: () => undefined })
    );

    expect(result).toMatchObject({
      status: "invalid",
      readiness: { checks: { repository: "ok", branch: "ok", composePath: "failed" } }
    });
  });
});
