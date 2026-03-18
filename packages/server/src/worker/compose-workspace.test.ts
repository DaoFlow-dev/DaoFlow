import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";

describe("prepareComposeWorkspace", () => {
  let stageDir: string;

  beforeEach(() => {
    stageDir = mkdtempSync(join(tmpdir(), "daoflow-compose-workspace-"));
    writeFileSync(join(stageDir, "compose.yaml"), "services:\n  app:\n    image: nginx:alpine\n");
    writeFileSync(join(stageDir, "context.tar.gz"), "placeholder archive");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    rmSync(stageDir, { recursive: true, force: true });
  });

  it("extracts uploaded remote context locally before materializing compose env artifacts", async () => {
    const callOrder: string[] = [];

    vi.doMock("./docker-executor", () => ({
      createTarArchive: vi.fn(),
      ensureStagingDir: vi.fn(() => stageDir),
      extractTarArchive: vi.fn((_archivePath: string, destinationDir: string) => {
        callOrder.push("extract-local-context");
        writeFileSync(join(destinationDir, ".env"), "FROM_ARCHIVE=1\n");
        return { exitCode: 0 };
      }),
      getStagingArchivePath: vi.fn(),
      gitClone: vi.fn()
    }));

    vi.doMock("./ssh-executor", () => ({
      remoteEnsureDir: vi.fn(() => {
        callOrder.push("remote-ensure");
        return { exitCode: 0 };
      }),
      remoteExtractArchive: vi.fn(() => {
        callOrder.push("remote-extract");
        return { exitCode: 0 };
      }),
      remoteGitClone: vi.fn(),
      scpUpload: vi.fn((_ssh: unknown, localPath: string) => {
        callOrder.push(`upload:${basename(localPath)}`);
        return { exitCode: 0 };
      })
    }));

    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn()
    }));

    const { prepareComposeWorkspace } = await import("./compose-workspace");

    const workspace = await prepareComposeWorkspace(
      "deploy_123",
      {
        deploymentSource: "uploaded-context",
        uploadedComposeFileName: "compose.yaml",
        uploadedContextArchiveName: "context.tar.gz"
      },
      {
        mode: "remote",
        ssh: {
          serverName: "deploy-target",
          host: "example.com",
          port: 22
        },
        remoteWorkDir: "/tmp/daoflow-staging/deploy_123"
      },
      () => {},
      {
        kind: "queued",
        entries: [
          {
            key: "RUNTIME_ONLY",
            value: "2",
            category: "runtime",
            isSecret: false,
            source: "inline",
            branchPattern: null
          }
        ]
      }
    );

    expect(callOrder.indexOf("extract-local-context")).toBeGreaterThan(-1);
    expect(callOrder.indexOf("extract-local-context")).toBeLessThan(
      callOrder.indexOf("upload:context.tar.gz")
    );
    expect(callOrder).toContain("upload:.daoflow.compose.env");
    expect(workspace.composeEnv?.composeEnv.counts.repoDefaults).toBe(1);
    expect(workspace.composeEnv?.payloadEntries.map((entry) => entry.key)).toEqual([
      "FROM_ARCHIVE",
      "RUNTIME_ONLY"
    ]);
  });
});
