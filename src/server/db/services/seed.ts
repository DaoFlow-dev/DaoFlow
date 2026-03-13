import { randomUUID } from "node:crypto";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { projects, environments } from "../schema/projects";
import { deployments, deploymentSteps, deploymentLogs } from "../schema/deployments";
import { volumes, backupPolicies, backupRuns } from "../schema/storage";
import { auditEntries, events, approvalRequests } from "../schema/audit";
import { apiTokens, principals } from "../schema/tokens";
import { encrypt } from "../crypto";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

export async function seedControlPlaneData() {
  const now = new Date();
  const serverId = id();

  // Seed server
  await db.insert(servers).values({
    id: serverId,
    name: "foundation-us-west-1",
    host: "10.0.1.100",
    region: "us-west-1",
    sshPort: 22,
    kind: "docker-engine",
    status: "ready",
    dockerVersion: "27.5.1",
    lastCheckedAt: now
  }).onConflictDoNothing();

  // Seed project
  const projectId = id();
  await db.insert(projects).values({
    id: projectId,
    name: "DaoFlow",
    slug: "daoflow",
    teamId: "default",
    repoFullName: "daoflow/daoflow",
    repoUrl: "https://github.com/daoflow/daoflow",
    sourceType: "compose",
    config: {}
  }).onConflictDoNothing();

  // Seed environment
  const envId = id();
  await db.insert(environments).values({
    id: envId,
    name: "production-us-west",
    slug: "production",
    projectId
  }).onConflictDoNothing();

  // Seed deployment
  const deploymentId = id();
  await db.insert(deployments).values({
    id: deploymentId,
    projectId,
    environmentId: envId,
    targetServerId: serverId,
    serviceName: "daoflow-api",
    sourceType: "compose",
    commitSha: "abc1234",
    imageTag: "daoflow/api:latest",
    configSnapshot: {},
    status: "completed",
    conclusion: "succeeded",
    trigger: "user",
    concludedAt: now
  }).onConflictDoNothing();

  // Seed deployment steps
  const stepLabels = ["Clone repository", "Build image", "Push to registry", "Deploy container", "Health check"];
  for (let i = 0; i < stepLabels.length; i++) {
    await db.insert(deploymentSteps).values({
      deploymentId,
      label: stepLabels[i],
      detail: `Completed ${stepLabels[i].toLowerCase()}`,
      status: "completed",
      startedAt: new Date(now.getTime() - (5 - i) * 60_000),
      completedAt: new Date(now.getTime() - (4 - i) * 60_000)
    }).onConflictDoNothing();
  }

  // Seed logs
  const logMessages = [
    "Starting deployment pipeline",
    "Cloning repository daoflow/daoflow@abc1234",
    "Building Docker image daoflow/api:latest",
    "Image built successfully in 45s",
    "Container started, health check passed"
  ];
  for (const msg of logMessages) {
    await db.insert(deploymentLogs).values({
      deploymentId,
      level: "info",
      message: msg,
      source: "build"
    }).onConflictDoNothing();
  }

  // Seed volume + backup policy
  const volumeId = id();
  await db.insert(volumes).values({
    id: volumeId,
    name: "postgres-data",
    serverId,
    mountPath: "/var/lib/postgresql/data",
    sizeBytes: "1073741824",
    status: "active"
  }).onConflictDoNothing();

  const policyId = id();
  await db.insert(backupPolicies).values({
    id: policyId,
    name: "Daily Postgres backup",
    volumeId,
    schedule: "0 2 * * *",
    retentionDays: 14,
    storageTarget: "s3://daoflow-backups/postgres",
    status: "active"
  }).onConflictDoNothing();

  await db.insert(backupRuns).values({
    id: id(),
    policyId,
    status: "succeeded",
    artifactPath: "s3://daoflow-backups/postgres/2026-03-12.tar.gz",
    sizeBytes: "524288000",
    startedAt: new Date(now.getTime() - 86_400_000),
    completedAt: new Date(now.getTime() - 86_340_000)
  }).onConflictDoNothing();

  // Seed audit entry
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: "system",
    actorEmail: "admin@daoflow.io",
    actorRole: "owner",
    targetResource: `deployment/${deploymentId}`,
    action: "deployment.created",
    inputSummary: "Manual deployment of daoflow-api@abc1234",
    permissionScope: "deploy:start",
    outcome: "success"
  }).onConflictDoNothing();

  // Seed event
  await db.insert(events).values({
    kind: "deployment.completed",
    resourceType: "deployment",
    resourceId: deploymentId,
    summary: "Deployment succeeded",
    detail: "daoflow-api deployed to foundation-us-west-1",
    severity: "info"
  }).onConflictDoNothing();

  console.log("Control plane seed data inserted.");
}
