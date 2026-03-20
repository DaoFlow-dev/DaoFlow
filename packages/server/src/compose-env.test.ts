import { describe, expect, it } from "vitest";
import {
  encryptComposeDeploymentState,
  readDeploymentComposeState,
  encryptComposeDeploymentEnvEntries,
  readDeploymentComposeEnvState
} from "./db/services/compose-env";
import { buildComposeEnvPlanDiagnostics } from "./compose-env-plan";
import {
  buildComposeEnvArtifact,
  buildQueuedComposeEnvEvidence,
  matchesComposeEnvBranchPattern,
  parseComposeEnvFile,
  renderComposeEnvExportFile,
  renderComposeEnvFile
} from "./compose-env";

describe("compose env resolution", () => {
  it("matches wildcard branch patterns for deployment env selection", () => {
    expect(matchesComposeEnvBranchPattern(null, "main")).toBe(true);
    expect(matchesComposeEnvBranchPattern("preview/*", "preview/pr-42")).toBe(true);
    expect(matchesComposeEnvBranchPattern("preview/*", "main")).toBe(false);
    expect(matchesComposeEnvBranchPattern("release/*/hotfix", "release/2026/hotfix")).toBe(true);
  });

  it("parses repo .env files and ignores invalid lines", () => {
    const parsed = parseComposeEnvFile(`# comment
PLAIN=value
QUOTED="hello world"
export TRAILING=value # comment
bad line
1INVALID=value
`);

    expect(parsed.entries).toEqual([
      { key: "PLAIN", value: "value" },
      { key: "QUOTED", value: "hello world" },
      { key: "TRAILING", value: "value" }
    ]);
    expect(parsed.warnings).toEqual([
      "Ignored invalid .env line 5.",
      'Ignored invalid .env key "1INVALID" on line 6.'
    ]);
  });

  it("merges repo defaults with deployment env entries and redacts evidence", () => {
    const artifact = buildComposeEnvArtifact({
      branch: "preview/pr-12",
      repoDefaultContent: "FROM_REPO=1\nSHARED=repo-default\n",
      deploymentEntries: [
        {
          key: "DATABASE_URL",
          value: "postgres://secret",
          category: "runtime",
          isSecret: true,
          source: "inline",
          branchPattern: "preview/*"
        },
        {
          key: "SHARED",
          value: "control-plane",
          category: "build",
          isSecret: false,
          source: "1password",
          branchPattern: null
        }
      ]
    });

    expect(artifact.envFileContents).toBe(
      "DATABASE_URL=postgres://secret\nFROM_REPO=1\nSHARED=control-plane\n"
    );
    expect(artifact.composeEnv.counts).toMatchObject({
      total: 3,
      repoDefaults: 1,
      environmentVariables: 2,
      runtime: 1,
      build: 1,
      secrets: 1,
      overriddenRepoDefaults: 1
    });
    expect(artifact.composeEnv.entries).toEqual([
      expect.objectContaining({
        key: "DATABASE_URL",
        displayValue: "[secret]",
        source: "inline",
        origin: "environment-variable"
      }),
      expect.objectContaining({
        key: "FROM_REPO",
        displayValue: "[repo-default]",
        origin: "repo-default"
      }),
      expect.objectContaining({
        key: "SHARED",
        displayValue: "control-plane",
        source: "1password",
        overrodeRepoDefault: true
      })
    ]);
  });

  it("escapes compose interpolation tokens for DaoFlow-managed env values", () => {
    const artifact = buildComposeEnvArtifact({
      branch: "main",
      repoDefaultContent: "FROM_REPO=$HOME\n",
      deploymentEntries: [
        {
          key: "DATABASE_URL",
          value: "postgres://user:p@ss$word@db/app",
          category: "runtime",
          isSecret: true,
          source: "inline",
          branchPattern: null
        }
      ]
    });

    expect(artifact.envFileContents).toBe(
      'DATABASE_URL="postgres://user:p@ss$$word@db/app"\nFROM_REPO="$HOME"\n'
    );
  });

  it("builds queued evidence without exposing plaintext secrets", () => {
    const evidence = buildQueuedComposeEnvEvidence("main", [
      {
        key: "API_TOKEN",
        value: "super-secret",
        category: "runtime",
        isSecret: true,
        source: "inline",
        branchPattern: null
      }
    ]);

    expect(evidence.status).toBe("queued");
    expect(evidence.entries).toEqual([
      expect.objectContaining({
        key: "API_TOKEN",
        displayValue: "[secret]"
      })
    ]);
  });

  it("rejects invalid environment variable keys when rendering env files", () => {
    expect(() =>
      renderComposeEnvFile([
        {
          key: "BAD KEY",
          value: "value"
        }
      ])
    ).toThrow('Invalid environment variable key "BAD KEY".');

    expect(() =>
      renderComposeEnvExportFile([
        {
          key: "ALSO-BAD",
          value: "value"
        }
      ])
    ).toThrow('Invalid environment variable key "ALSO-BAD".');
  });

  it("reports unresolved compose interpolation during planning", () => {
    const diagnostics = buildComposeEnvPlanDiagnostics({
      branch: "preview/pr-42",
      composeContent: [
        "services:",
        "  api:",
        "    image: example/api:${IMAGE_TAG}",
        "    environment:",
        "      DATABASE_URL: ${DATABASE_URL?required}",
        "      OPTIONAL_VALUE: $OPTIONAL_VALUE",
        "      FALLBACK_VALUE: ${FALLBACK_VALUE:-default}"
      ].join("\n"),
      repoDefaultContent: "IMAGE_TAG=preview-42\n",
      deploymentEntries: [
        {
          key: "DATABASE_URL",
          value: "postgres://preview",
          category: "runtime",
          isSecret: true,
          source: "inline",
          branchPattern: "preview/*"
        }
      ]
    });

    expect(diagnostics.composeEnv.counts.total).toBe(2);
    expect(diagnostics.matchedBranchOverrideCount).toBe(1);
    expect(diagnostics.interpolation.status).toBe("warn");
    expect(diagnostics.interpolation.summary.totalReferences).toBe(4);
    expect(diagnostics.interpolation.summary.optionalMissing).toBe(1);
    expect(diagnostics.interpolation.summary.requiredMissing).toBe(0);
    expect(diagnostics.interpolation.unresolved).toEqual([
      expect.objectContaining({
        expression: "$OPTIONAL_VALUE",
        severity: "warn"
      })
    ]);
  });

  it("marks compose interpolation analysis unavailable when compose content is missing", () => {
    const diagnostics = buildComposeEnvPlanDiagnostics({
      branch: "main",
      deploymentEntries: [],
      warnings: ["Compose source analysis could not read deploy/compose.yaml: unavailable."]
    });

    expect(diagnostics.interpolation.status).toBe("unavailable");
    expect(diagnostics.interpolation.warnings).toEqual([
      "Compose source analysis could not read deploy/compose.yaml: unavailable."
    ]);
  });

  it("preserves materialized repo-default entries when replaying encrypted deployment env state", () => {
    const encrypted = encryptComposeDeploymentEnvEntries([
      {
        key: "FROM_REPO",
        value: "frozen",
        category: "default",
        isSecret: false,
        source: "repo-default",
        branchPattern: null,
        origin: "repo-default",
        overrodeRepoDefault: false
      }
    ]);

    expect(readDeploymentComposeEnvState(encrypted)).toEqual({
      kind: "materialized",
      entries: [
        {
          key: "FROM_REPO",
          value: "frozen",
          category: "default",
          isSecret: false,
          source: "repo-default",
          branchPattern: null,
          origin: "repo-default",
          overrodeRepoDefault: false
        }
      ]
    });
  });

  it("preserves frozen compose input payloads inside encrypted deployment state", () => {
    const encrypted = encryptComposeDeploymentState({
      envEntries: [
        {
          key: "RUNTIME_ONLY",
          value: "1",
          category: "runtime",
          isSecret: false,
          source: "inline",
          branchPattern: null
        }
      ],
      frozenInputs: {
        composeFile: {
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "compose.yaml",
          contents: "services:\n  api:\n    image: nginx:alpine\n"
        },
        envFiles: [
          {
            path: ".daoflow.compose.inputs/runtime.env",
            sourcePath: "./runtime.env",
            contents: "API_TOKEN=secret\n",
            services: ["api"]
          }
        ]
      }
    });

    expect(readDeploymentComposeState(encrypted)).toEqual({
      envState: {
        kind: "queued",
        entries: [
          {
            key: "RUNTIME_ONLY",
            value: "1",
            category: "runtime",
            isSecret: false,
            source: "inline",
            branchPattern: null
          }
        ]
      },
      frozenInputs: {
        composeFiles: [
          {
            path: ".daoflow.compose.rendered.yaml",
            sourcePath: "compose.yaml",
            contents: "services:\n  api:\n    image: nginx:alpine\n"
          }
        ],
        envFiles: [
          {
            path: ".daoflow.compose.inputs/runtime.env",
            sourcePath: "./runtime.env",
            contents: "API_TOKEN=secret\n",
            services: ["api"]
          }
        ],
        profiles: [],
        renderedCompose: {
          path: ".daoflow.compose.rendered.yaml",
          contents: "services:\n  api:\n    image: nginx:alpine\n"
        }
      }
    });
  });
});
