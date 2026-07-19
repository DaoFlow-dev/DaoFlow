import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  resolveExecutionTarget: vi.fn(),
  resolveServiceRuntime: vi.fn(),
  select: vi.fn()
}));

vi.mock("drizzle-orm", () => ({
  and: vi.fn((...values: unknown[]) => values),
  desc: vi.fn((value: unknown) => value),
  eq: vi.fn((...values: unknown[]) => values)
}));
vi.mock("../connection", () => ({ db: { select: mocks.select } }));
vi.mock("../schema/destinations", () => ({ backupDestinations: {} }));
vi.mock("../schema/external-backup-artifacts", () => ({ externalBackupArtifacts: {} }));
vi.mock("../schema/projects", () => ({ projects: { id: {}, teamId: {} } }));
vi.mock("../schema/servers", () => ({ servers: { id: {}, teamId: {} } }));
vi.mock("../schema/services", () => ({ services: { id: {}, projectId: {} } }));
vi.mock("../schema/storage", () => ({ volumes: {} }));
vi.mock("../../worker/execution-target", () => ({
  resolveExecutionTarget: mocks.resolveExecutionTarget
}));
vi.mock("./backup-resource-team", () => ({ resolveVolumeTeamId: vi.fn() }));
vi.mock("./service-runtime", () => ({ resolveServiceRuntime: mocks.resolveServiceRuntime }));

import { resolveExternalPostgresRestoreRuntime } from "./external-backup-artifact-read";

const updatedAt = new Date("2026-07-19T00:00:00.000Z");
const volume = {
  id: "vol_postgres",
  serverId: "srv_approved",
  metadata: { serviceId: "svc_postgres" }
};
const service = {
  id: "svc_postgres",
  targetServerId: "srv_approved",
  updatedAt,
  config: {
    managedDatabase: {
      kind: "postgres",
      label: "PostgreSQL",
      templateSlug: "postgres",
      databaseName: "app",
      username: "app_user",
      port: "5432",
      internalPort: "5432",
      serviceName: "postgres",
      volumeName: "postgres-data",
      volumeId: "vol_postgres",
      backupEngine: "postgres",
      connectionUriMasked: "postgres://app_user:[redacted]@db/app",
      internalConnectionUriMasked: "postgres://app_user:[redacted]@db/app"
    }
  }
};

function selectRows(rows: unknown[]) {
  return {
    from: () => ({ innerJoin: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) })
  };
}

describe("external PostgreSQL restore runtime resolution", () => {
  beforeEach(() => {
    mocks.resolveExecutionTarget.mockReset();
    mocks.resolveServiceRuntime.mockReset();
    mocks.select.mockReset();
    mocks.select.mockImplementation(() =>
      selectRows([{ service, projectTeamId: "team_foundation" }])
    );
  });

  it.each([
    { mode: "local" as const },
    {
      mode: "remote" as const,
      remoteWorkDir: "/tmp/restore",
      ssh: { serverName: "production", host: "203.0.113.8", port: 22 }
    }
  ])("keeps the approved $mode server and its Compose runtime together", async (target) => {
    mocks.resolveServiceRuntime.mockResolvedValue({
      status: "ok",
      runtime: {
        kind: "compose",
        service: { id: "svc_postgres" },
        server: { id: "srv_approved" },
        target,
        projectName: "app-production",
        composeServiceName: "postgres"
      }
    });

    await expect(
      resolveExternalPostgresRestoreRuntime({
        volume: volume as never,
        teamId: "team_foundation",
        restoreId: "brest_postgres"
      })
    ).resolves.toMatchObject({
      target,
      runtime: {
        kind: "compose",
        projectName: "app-production",
        serviceName: "postgres"
      }
    });
  });

  it("fails closed when the live service runtime moves away from the approved volume server", async () => {
    mocks.resolveServiceRuntime.mockResolvedValue({
      status: "ok",
      runtime: {
        kind: "compose",
        service: { id: "svc_postgres" },
        server: { id: "srv_other" },
        target: { mode: "local" },
        projectName: "app-production",
        composeServiceName: "postgres"
      }
    });

    await expect(
      resolveExternalPostgresRestoreRuntime({
        volume: volume as never,
        teamId: "team_foundation",
        restoreId: "brest_postgres"
      })
    ).resolves.toBeNull();
  });
});
