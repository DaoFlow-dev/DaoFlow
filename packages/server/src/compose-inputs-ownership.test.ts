import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { materializeComposeInputs } from "./compose-inputs";

const identity = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_current"
};
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function renderedCompose(workDir: string, composeFile: string): Record<string, unknown> {
  return parseYaml(readFileSync(join(workDir, composeFile), "utf8")) as Record<string, unknown>;
}

describe("ownership Compose materialization", () => {
  it("applies ownership to fresh preview inputs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-ownership-fresh-"));
    tempDirs.push(workDir);
    writeFileSync(join(workDir, "compose.yaml"), "services:\n  api:\n    image: nginx:alpine\n");

    const result = materializeComposeInputs({
      workDir,
      composeFile: "compose.yaml",
      sourceProvenance: "repository-checkout",
      composeEnvFileContents: "",
      ownership: identity
    });

    const doc = renderedCompose(workDir, result.composeFile);
    const api = (doc.services as Record<string, Record<string, unknown>>).api;
    expect(api.labels).toMatchObject({ "io.daoflow.deployment-id": "deployment_current" });
    expect((doc.networks as Record<string, Record<string, unknown>>).default.labels).toMatchObject({
      "io.daoflow.service-id": "service_123"
    });
  });

  it("reapplies the current rollback deployment ID to replayed frozen inputs", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-ownership-replay-"));
    tempDirs.push(workDir);
    const result = materializeComposeInputs({
      workDir,
      composeFile: "missing.yaml",
      sourceProvenance: "uploaded-artifact",
      composeEnvFileContents: "",
      ownership: identity,
      existingFrozenInputs: {
        composeFile: {
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "compose.yaml",
          contents:
            "services:\n  api:\n    image: nginx:alpine\n    labels:\n      io.daoflow.deployment-id: stale\n"
        },
        envFiles: []
      }
    });

    const doc = renderedCompose(workDir, result.composeFile);
    const api = (doc.services as Record<string, Record<string, unknown>>).api;
    expect(api.labels).toMatchObject({ "io.daoflow.deployment-id": "deployment_current" });
  });
});
