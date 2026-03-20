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
        "    image: ghcr.io/daoflow/api:stable",
        "    env_file:",
        "      - ./config/runtime.env",
        "      - path: ./config/optional.env",
        "        required: false",
        "  web:",
        "    image: ghcr.io/daoflow/web:stable"
      ].join("\n")
    );
    mkdirSync(join(workDir, "config"), { recursive: true });
    writeFileSync(join(workDir, "config", "runtime.env"), "API_TOKEN=secret\n");

    const result = materializeComposeInputs({
      workDir,
      composeFile: "ops.compose.yaml",
      sourceProvenance: "repository-checkout",
      repoDefaultContent: "ROOT_ONLY=1\n",
      composeEnvFileContents: "ROOT_ONLY=1\n",
      imageOverride: {
        serviceName: "api",
        imageReference: "ghcr.io/daoflow/api:2.0.0"
      }
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
    expect(renderedCompose).toContain("image: ghcr.io/daoflow/api:2.0.0");
    expect(renderedCompose).toContain("image: ghcr.io/daoflow/web:stable");
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
      existingFrozenInputs: frozenInputs,
      imageOverride: {
        serviceName: "api",
        imageReference: "ghcr.io/daoflow/api:rollback"
      }
    });

    expect(result.composeFile).toBe(".daoflow.compose.rendered.yaml");
    expect(result.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "compose-file",
          path: ".daoflow.compose.rendered.yaml"
        })
      ])
    );
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).toBe(
      "services:\n  api:\n    image: ghcr.io/daoflow/api:rollback\n"
    );
  });

  it("replays previously frozen build contexts without renormalizing them against the original compose path", () => {
    const workDir = mkdtempSync(join(tmpdir(), "daoflow-compose-replay-build-"));
    tempDirs.push(workDir);

    const frozenInputs: FrozenComposeInputsPayload = {
      composeFile: {
        path: ".daoflow.compose.rendered.yaml",
        sourcePath: "deploy/compose.yaml",
        contents: [
          "services:",
          "  api:",
          "    build:",
          "      context: deploy",
          "      dockerfile: ../Dockerfile",
          "secrets:",
          "  npm_token:",
          "    file: deploy/secrets/npm.token"
        ].join("\n")
      },
      envFiles: []
    };

    const result = materializeComposeInputs({
      workDir,
      composeFile: "missing-compose.yaml",
      sourceProvenance: "uploaded-artifact",
      composeEnvFileContents: "",
      existingFrozenInputs: frozenInputs,
      existingBuildPlan: {
        status: "materialized",
        version: 1,
        stackName: null,
        strategy: "build-only",
        services: [
          {
            serviceName: "api",
            context: "deploy",
            contextType: "local-path",
            image: null,
            dockerfile: "../Dockerfile",
            target: null,
            args: [],
            additionalContexts: [],
            secrets: [
              {
                sourceName: "npm_token",
                provider: "file",
                reference: "deploy/secrets/npm.token",
                target: null
              }
            ]
          }
        ],
        graphServices: [
          {
            serviceName: "api",
            image: null,
            hasBuild: true,
            dependsOn: [],
            healthcheck: {
              present: false,
              disabled: false,
              testType: "none",
              interval: null,
              timeout: null,
              startPeriod: null,
              startInterval: null,
              retries: null
            },
            networks: [],
            namedVolumes: [],
            runtimeSecrets: [],
            configs: [],
            profiles: []
          }
        ],
        networks: [],
        volumes: [],
        secrets: [],
        configs: [],
        warnings: ["Preserved build-plan warning"]
      }
    });

    expect(result.buildPlan).toMatchObject({
      strategy: "build-only",
      services: [
        {
          serviceName: "api",
          context: "deploy",
          dockerfile: "../Dockerfile"
        }
      ],
      warnings: ["Preserved build-plan warning"]
    });
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).toContain("context: deploy");
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).not.toContain(
      "context: deploy/deploy"
    );
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).toContain(
      "file: deploy/secrets/npm.token"
    );
    expect(readFileSync(join(workDir, result.composeFile), "utf8")).not.toContain(
      "file: deploy/deploy/secrets/npm.token"
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
