import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  materializeComposeInputs,
  type ComposeInputManifest,
  type FrozenComposeInputsPayload
} from "./compose-inputs";

const tempDirs: string[] = [];

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    if (dir) {
      rmSync(dir, { recursive: true, force: true });
    }
  }
});

describe("compose input materialization", () => {
  it("rewrites service env_file references into frozen artifacts and records manifest evidence", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-compose-inputs-"));
    tempDirs.push(workDir);

    writeFileSync(
      join(workDir, "ops.compose.yaml"),
      [
        "services:",
        "  api:",
        "    image: nginx:alpine",
        "    env_file:",
        "      - ./config/runtime.env",
        "      - path: ./config/optional.env",
        "        required: false"
      ].join("\n")
    );
    mkdirSync(join(workDir, "config"), { recursive: true });
    writeFileSync(join(workDir, "config", "runtime.env"), "API_TOKEN=secret\n");

    const result = materializeComposeInputs({
      workDir,
      composeFile: "ops.compose.yaml",
      sourceProvenance: "repository-checkout",
      repoDefaultContent: "ROOT_ONLY=1\n",
      composeEnvFileContents: "ROOT_ONLY=1\n"
    });

    expect(result.composeFile).toBe(".daoflow.compose.rendered.yaml");
    expect(result.manifest.entries).toEqual([
      expect.objectContaining({
        kind: "compose-env",
        path: ".daoflow.compose.env"
      }),
      expect.objectContaining({
        kind: "compose-file",
        path: ".daoflow.compose.rendered.yaml",
        sourcePath: "ops.compose.yaml"
      }),
      expect.objectContaining({
        kind: "repo-default-env",
        path: ".env",
        provenance: "repository-checkout"
      }),
      expect.objectContaining({
        kind: "service-env-file",
        path: ".daoflow.compose.inputs/config__runtime.env",
        sourcePath: "config/runtime.env",
        services: ["api"]
      })
    ]);
    expect(result.manifest.warnings).toEqual([
      'Skipped optional env_file "./config/optional.env" for service "api" because it was not present in the frozen workspace.'
    ]);

    const renderedCompose = readFileSync(join(workDir, result.composeFile), "utf8");
    expect(renderedCompose).toContain(".daoflow.compose.inputs/config__runtime.env");
    expect(renderedCompose).not.toContain("./config/runtime.env");
  });

  it("replays previously frozen compose inputs without rereading repository files", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-compose-replay-"));
    tempDirs.push(workDir);

    const manifest: ComposeInputManifest = {
      status: "materialized",
      version: 1,
      warnings: [],
      entries: [
        {
          kind: "compose-file",
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "compose.yaml",
          sha256: "compose",
          sizeBytes: 10,
          provenance: "daoflow-generated",
          services: []
        },
        {
          kind: "compose-env",
          path: ".daoflow.compose.env",
          sourcePath: null,
          sha256: "env",
          sizeBytes: 10,
          provenance: "daoflow-generated",
          services: []
        }
      ]
    };
    const frozenInputs: FrozenComposeInputsPayload = {
      composeFile: {
        path: ".daoflow.compose.rendered.yaml",
        sourcePath: "compose.yaml",
        contents: "services:\n  api:\n    image: nginx:alpine\n"
      },
      envFiles: []
    };

    const result = materializeComposeInputs({
      workDir,
      composeFile: "missing-compose.yaml",
      sourceProvenance: "uploaded-artifact",
      composeEnvFileContents: "STATIC=1\n",
      existingManifest: manifest,
      existingFrozenInputs: frozenInputs
    });

    expect(result.composeFile).toBe(".daoflow.compose.rendered.yaml");
    expect(result.manifest).toEqual(manifest);
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).toBe(
      "services:\n  api:\n    image: nginx:alpine\n"
    );
  });

  it("rejects env_file references that escape the deployment workspace", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-compose-traversal-"));
    tempDirs.push(workDir);

    writeFileSync(
      join(workDir, "compose.yaml"),
      [
        "services:",
        "  api:",
        "    image: nginx:alpine",
        "    env_file:",
        "      - ../../../../etc/passwd"
      ].join("\n")
    );

    expect(() =>
      materializeComposeInputs({
        workDir,
        composeFile: "compose.yaml",
        sourceProvenance: "repository-checkout",
        composeEnvFileContents: ""
      })
    ).toThrow(
      'Compose env_file "../../../../etc/passwd" resolves outside of the deployment workspace.'
    );
  });
});
