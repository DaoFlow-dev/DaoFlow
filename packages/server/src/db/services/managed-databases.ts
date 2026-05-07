import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { and, desc, eq } from "drizzle-orm";
import {
  getManagedDatabaseDefinition,
  managedDatabaseDefinitions,
  renderAppTemplate,
  type ManagedDatabaseKind
} from "@daoflow/shared";
import {
  backupEngineForKind,
  buildManagedDatabaseMetadata,
  buildTemplateValues,
  cleanName,
  secret
} from "./managed-database-helpers";
import { parseComposeBuildPlan } from "./compose-deployment-plan-build";
import { ensureStagingDir } from "../../worker/docker-executor";
import { persistUploadedArtifacts } from "../../worker/uploaded-artifacts";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import { createDeploymentRecord } from "./deployments";
import { ensureDirectDeploymentScope } from "./direct-deployments";
import { updateService } from "./services";
import { createBackupPolicy } from "./storage-management-policies";
import { createVolume } from "./storage-management-volumes";
import { db } from "../connection";
import { projects } from "../schema/projects";
import { services } from "../schema/services";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import { readManagedDatabaseConfigFromConfig } from "../../managed-database-config";

interface ActorContext {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateManagedDatabaseInput extends ActorContext {
  kind: ManagedDatabaseKind;
  projectId: string;
  environmentName?: string;
  serverId: string;
  name?: string;
  databaseName?: string;
  username?: string;
  password?: string;
  rootPassword?: string;
  port?: string;
}

export function listManagedDatabaseCatalog() {
  return managedDatabaseDefinitions.map((definition) => ({
    kind: definition.kind,
    label: definition.label,
    templateSlug: definition.templateSlug,
    defaultDatabaseName: definition.defaultDatabaseName,
    defaultUsername: definition.defaultUsername,
    defaultPort: definition.defaultPort,
    internalPort: definition.internalPort,
    serviceName: definition.serviceName
  }));
}

export async function listManagedDatabases(input: { teamId: string; limit?: number }) {
  const rows = await db
    .select({ service: services, projectName: projects.name })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(projects.teamId, input.teamId), eq(services.sourceType, "compose")))
    .orderBy(desc(services.createdAt))
    .limit(input.limit ?? 50);

  return rows
    .map((row) => ({
      service: row.service,
      projectName: row.projectName,
      managedDatabase: readManagedDatabaseConfigFromConfig(row.service.config)
    }))
    .filter((row) => row.managedDatabase !== null)
    .map((row) => ({
      serviceId: row.service.id,
      serviceName: row.service.name,
      projectId: row.service.projectId,
      projectName: row.projectName,
      environmentId: row.service.environmentId,
      status: row.service.status,
      targetServerId: row.service.targetServerId,
      createdAt: row.service.createdAt.toISOString(),
      updatedAt: row.service.updatedAt.toISOString(),
      database: row.managedDatabase
    }));
}

export async function createManagedDatabase(input: CreateManagedDatabaseInput) {
  const definition = getManagedDatabaseDefinition(input.kind);
  if (!definition) return { status: "unsupported-kind" as const };

  const databaseName = definition.defaultDatabaseName
    ? cleanName(input.databaseName, definition.defaultDatabaseName)
    : null;
  const username = definition.defaultUsername
    ? cleanName(input.username, definition.defaultUsername)
    : null;
  const password = input.password?.trim() || secret();
  const rootPassword =
    input.rootPassword?.trim() || (definition.rootPasswordField ? secret() : password);
  const port = input.port?.trim() || definition.defaultPort;
  const serviceName = cleanName(input.name, definition.serviceName);
  const rendered = renderAppTemplate({
    slug: definition.templateSlug,
    projectName: serviceName,
    values: buildTemplateValues({
      kind: input.kind,
      databaseName,
      username,
      password,
      rootPassword,
      port
    })
  });
  const deploymentId = id();
  const composePath = `managed-databases/${definition.templateSlug}.yaml`;
  const stageDir = ensureStagingDir(deploymentId);
  await mkdir(dirname(join(stageDir, composePath)), { recursive: true });
  await writeFile(join(stageDir, composePath), rendered.compose, "utf8");
  const { artifactId } = await persistUploadedArtifacts({
    sourceDir: stageDir,
    composeFileName: composePath
  });
  const managedDatabase = buildManagedDatabaseMetadata({
    definition,
    databaseName,
    username,
    port,
    stackName: rendered.stackName
  });
  const scope = await ensureDirectDeploymentScope({
    serverId: input.serverId,
    projectRef: input.projectId,
    projectName: serviceName,
    environmentName: input.environmentName,
    serviceName,
    managedDatabase,
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });
  const volumeResult = await createVolume(
    {
      name: managedDatabase.volumeName,
      serverId: input.serverId,
      mountPath: definition.volumeMountPath,
      serviceId: scope.service.id
    },
    {
      userId: input.requestedByUserId,
      email: input.requestedByEmail,
      role: input.requestedByRole
    }
  );
  if (volumeResult.status !== "ok") {
    throw new Error(
      "message" in volumeResult
        ? volumeResult.message
        : `Unable to register managed database ${volumeResult.entity}.`
    );
  }
  const backupEngine = backupEngineForKind(input.kind);
  const backupPolicyResult = await createBackupPolicy(
    {
      name: `${serviceName} backup policy`,
      volumeId: volumeResult.volume.id,
      backupType: backupEngine ? "database" : "volume",
      databaseEngine: backupEngine,
      turnOff: false,
      retentionDays: 30
    },
    {
      userId: input.requestedByUserId,
      email: input.requestedByEmail,
      role: input.requestedByRole
    }
  );
  if (backupPolicyResult.status !== "ok") {
    throw new Error(
      "message" in backupPolicyResult
        ? backupPolicyResult.message
        : `Unable to create managed database ${backupPolicyResult.entity}.`
    );
  }
  const managedDatabaseWithBackup = {
    ...managedDatabase,
    volumeId: volumeResult.volume.id,
    backupPolicyId: backupPolicyResult.policy.id,
    backupType: backupEngine ? ("database" as const) : ("volume" as const),
    backupEngine
  };
  const updatedService = await updateService({
    serviceId: scope.service.id,
    managedDatabase: managedDatabaseWithBackup,
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });
  if (updatedService.status !== "ok") {
    throw new Error("Unable to link managed database backup metadata to the service.");
  }
  const plan = parseComposeBuildPlan(rendered.compose);
  const deployment = await createDeploymentRecord({
    deploymentId,
    projectName: scope.project.name,
    environmentName: scope.environment.name,
    serviceName: scope.service.name,
    sourceType: "compose",
    targetServerId: scope.service.targetServerId ?? input.serverId,
    commitSha: "",
    imageTag: "",
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    steps: [
      { label: "Render managed database", detail: `Render ${definition.label} Compose source.` },
      { label: "Queue execution handoff", detail: "Dispatch the database stack to the worker." }
    ],
    configSnapshot: {
      deploymentSource: "uploaded-compose",
      composeFilePath: composePath,
      composeFilePaths: [composePath],
      uploadedComposeFileName: composePath,
      uploadedComposeFileNames: [composePath],
      uploadedArtifactId: artifactId,
      stackName: rendered.stackName,
      managedDatabase: managedDatabaseWithBackup,
      composeBuildPlan: plan
    }
  });
  if (!deployment) throw new Error("Failed to create deployment record.");
  await dispatchDeploymentExecution(deployment);

  return {
    status: "ok" as const,
    service: updatedService.service,
    deployment,
    managedDatabase: managedDatabaseWithBackup,
    volume: volumeResult.volume,
    backupPolicy: backupPolicyResult.policy
  };
}
