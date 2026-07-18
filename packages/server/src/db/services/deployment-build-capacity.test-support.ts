import { eq } from "drizzle-orm";
import { vi } from "vitest";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import type { OnLog } from "../../worker/docker-executor";
import { createEnvironment, createProject } from "./projects";

let fixtureCounter = 0;

function nextFixtureSuffix(): string {
  fixtureCounter += 1;
  return `${Date.now().toString(36)}-${fixtureCounter}`;
}

export function createDeferred() {
  let resolve: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve: () => resolve() };
}

export async function waitUntil(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 1_000
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!(await predicate())) {
    if (Date.now() >= deadline) {
      throw new Error("Timed out while waiting for the build lease test condition.");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export async function createLeaseDeployment(label: string): Promise<string> {
  const suffix = nextFixtureSuffix();
  const projectResult = await createProject({
    name: `Build lease ${label} ${suffix}`,
    description: "Build lease test fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create build lease project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `lease-${suffix}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create build lease environment fixture.");
  }

  const deploymentId = `lease-${label}-${suffix}`.slice(0, 32);
  await db.insert(deployments).values({
    id: deploymentId,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    targetServerId: "srv_foundation_1",
    serviceName: `service-${label}`,
    sourceType: "dockerfile",
    commitSha: "0123456789abcdef0123456789abcdef01234567",
    imageTag: `ghcr.io/daoflow/${label}:test`,
    status: "waiting",
    configSnapshot: {},
    createdAt: new Date(),
    updatedAt: new Date()
  });

  return deploymentId;
}

export function leaseOptions(deploymentId: string): {
  deploymentId: string;
  serverId: string;
  onLog: OnLog;
  leaseDurationMs: number;
  heartbeatIntervalMs: number;
  retryIntervalMs: number;
} {
  return {
    deploymentId,
    serverId: "srv_foundation_1",
    onLog: vi.fn(),
    leaseDurationMs: 1_000,
    heartbeatIntervalMs: 25,
    retryIntervalMs: 5
  };
}

export async function resetBuildCapacityFixture(): Promise<void> {
  await resetTestDatabaseWithControlPlane();
  await db
    .update(servers)
    .set({ maxConcurrentBuilds: 1 })
    .where(eq(servers.id, "srv_foundation_1"));
}
