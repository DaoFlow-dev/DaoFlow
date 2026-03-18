import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { resolveTeamIdForUser } from "./teams";

type PlanCheckStatus = "ok" | "warn" | "fail";
type ScopeAction = "reuse" | "create";

function makeCheck(status: PlanCheckStatus, detail: string) {
  return { status, detail };
}

function sanitizeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  return cleaned.slice(0, 80) || fallback;
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

function deriveStackName(composeContent: string, fallback: string): string {
  const namedMatch = composeContent.match(/^\s*name\s*:\s*["']?([^"'#\n]+)["']?\s*$/m);
  if (namedMatch?.[1]) {
    return namedMatch[1].trim();
  }

  const firstServiceMatch = composeContent.match(/^\s{2}([a-zA-Z0-9._-]+)\s*:\s*$/m);
  if (firstServiceMatch?.[1]) {
    return firstServiceMatch[1].trim();
  }

  return fallback;
}

function formatBytes(sizeBytes: number): string {
  if (sizeBytes < 1024) {
    return `${sizeBytes} B`;
  }

  const sizeMb = sizeBytes / 1024 / 1024;
  if (sizeMb < 1) {
    return `${(sizeBytes / 1024).toFixed(1)} KB`;
  }

  return `${sizeMb.toFixed(1)} MB`;
}

async function resolveServer(serverRef: string) {
  const ref = serverRef.trim();
  if (!ref) {
    throw new Error("Server reference is required.");
  }

  const [byId] = await db.select().from(servers).where(eq(servers.id, ref)).limit(1);
  if (byId) {
    return byId;
  }

  const [byName] = await db.select().from(servers).where(eq(servers.name, ref)).limit(1);
  if (byName) {
    return byName;
  }

  throw new Error(`Server "${ref}" not found.`);
}

async function resolveExistingScope(input: {
  projectName: string;
  environmentName: string;
  serviceName: string;
}) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, input.projectName))
    .limit(1);

  if (!project) {
    return {
      project: { id: null, name: input.projectName, action: "create" as const },
      environment: {
        id: null,
        name: input.environmentName,
        action: "create" as const,
        currentTargetServerId: null as string | null
      },
      service: {
        id: null,
        name: input.serviceName,
        action: "create" as const,
        currentTargetServerId: null as string | null,
        currentSourceType: null as string | null
      }
    };
  }

  const [environment] = await db
    .select()
    .from(environments)
    .where(
      and(
        eq(environments.projectId, project.id),
        eq(environments.slug, toSlug(input.environmentName))
      )
    )
    .limit(1);

  if (!environment) {
    return {
      project: { id: project.id, name: project.name, action: "reuse" as const },
      environment: {
        id: null,
        name: input.environmentName,
        action: "create" as const,
        currentTargetServerId: null as string | null
      },
      service: {
        id: null,
        name: input.serviceName,
        action: "create" as const,
        currentTargetServerId: null as string | null,
        currentSourceType: null as string | null
      }
    };
  }

  const environmentConfig =
    environment.config &&
    typeof environment.config === "object" &&
    !Array.isArray(environment.config)
      ? (environment.config as Record<string, unknown>)
      : {};

  const [service] = await db
    .select()
    .from(services)
    .where(
      and(eq(services.environmentId, environment.id), eq(services.slug, toSlug(input.serviceName)))
    )
    .limit(1);

  return {
    project: { id: project.id, name: project.name, action: "reuse" as const },
    environment: {
      id: environment.id,
      name: environment.name,
      action: "reuse" as const,
      currentTargetServerId:
        typeof environmentConfig.targetServerId === "string"
          ? environmentConfig.targetServerId
          : null
    },
    service: {
      id: service?.id ?? null,
      name: service?.name ?? input.serviceName,
      action: (service ? "reuse" : "create") as ScopeAction,
      currentTargetServerId: service?.targetServerId ?? null,
      currentSourceType: service?.sourceType ?? null
    }
  };
}

function buildComposePlanSteps(input: {
  requiresContextUpload: boolean;
  targetServerName: string;
}) {
  if (input.requiresContextUpload) {
    return [
      "Freeze the compose file and local build-context manifest",
      "Bundle the local build context while respecting .dockerignore rules",
      "Upload the staged archive and compose file to the DaoFlow control plane",
      "Dispatch the uploaded compose workspace to the execution plane",
      `Run docker compose up -d --build on ${input.targetServerName}`,
      "Record health checks and the final deployment outcome"
    ];
  }

  return [
    "Freeze the compose file for an immutable deployment record",
    "Stage the compose file in durable control-plane storage",
    "Dispatch the compose deployment to the execution plane",
    `Run docker compose up -d --build on ${input.targetServerName}`,
    "Record health checks and the final deployment outcome"
  ];
}

function buildExecuteCommand(input: {
  composePath?: string;
  contextPath?: string;
  requiresContextUpload: boolean;
  serverId: string;
}) {
  const command = [
    "daoflow deploy",
    `--compose ${input.composePath ?? "<compose-path>"}`,
    `--server ${input.serverId}`
  ];

  if (input.requiresContextUpload || (input.contextPath && input.contextPath !== ".")) {
    command.push(`--context ${input.contextPath ?? "."}`);
  }

  command.push("--yes");
  return command.join(" ");
}

export interface ComposeDeploymentPlanInput {
  composeContent: string;
  composePath?: string;
  contextPath?: string;
  serverRef: string;
  localBuildContexts: Array<{
    serviceName: string;
    context: string;
    dockerfile?: string | null;
  }>;
  requiresContextUpload: boolean;
  contextBundle?: {
    fileCount: number;
    sizeBytes: number;
    includedOverrides: string[];
  } | null;
  contextBundleError?: string;
  requestedByUserId: string;
}

export async function buildComposeDeploymentPlan(input: ComposeDeploymentPlanInput) {
  const composeContent = input.composeContent.trim();
  if (!composeContent) {
    throw new Error("Compose content is required.");
  }

  const resolvedServer = await resolveServer(input.serverRef);
  const teamId = await resolveTeamIdForUser(input.requestedByUserId);

  const derivedName = deriveStackName(composeContent, "uploaded-compose");
  const projectName = sanitizeName(derivedName, "uploaded-compose");
  const environmentName = "production";
  const serviceName = sanitizeName(derivedName, projectName);
  const scope = await resolveExistingScope({
    projectName,
    environmentName,
    serviceName
  });

  const checks = [
    teamId
      ? makeCheck("ok", "Organization scope resolved for direct compose deployment.")
      : makeCheck("fail", "No organization is available for this user."),
    makeCheck("ok", `Target server resolved to ${resolvedServer.name} (${resolvedServer.host}).`),
    scope.project.action === "reuse"
      ? makeCheck("ok", `Project ${scope.project.name} will be reused.`)
      : makeCheck("warn", `Project ${scope.project.name} will be created during execution.`),
    scope.environment.action === "reuse"
      ? makeCheck("ok", `Environment ${scope.environment.name} will be reused.`)
      : makeCheck(
          "warn",
          `Environment ${scope.environment.name} will be created during execution.`
        ),
    scope.service.action === "reuse"
      ? makeCheck("ok", `Service ${scope.service.name} will be reused.`)
      : makeCheck("warn", `Service ${scope.service.name} will be created during execution.`)
  ];

  if (
    scope.environment.currentTargetServerId &&
    scope.environment.currentTargetServerId !== resolvedServer.id
  ) {
    checks.push(
      makeCheck(
        "warn",
        `Environment ${scope.environment.name} is currently targeted at ${scope.environment.currentTargetServerId}; execution will retarget it to ${resolvedServer.id}.`
      )
    );
  }

  if (
    scope.service.currentTargetServerId &&
    scope.service.currentTargetServerId !== resolvedServer.id
  ) {
    checks.push(
      makeCheck(
        "warn",
        `Service ${scope.service.name} is currently targeted at ${scope.service.currentTargetServerId}; execution will retarget it to ${resolvedServer.id}.`
      )
    );
  }

  if (scope.service.currentSourceType && scope.service.currentSourceType !== "compose") {
    checks.push(
      makeCheck(
        "warn",
        `Service ${scope.service.name} currently uses ${scope.service.currentSourceType}; execution will switch it to compose.`
      )
    );
  }

  if (input.requiresContextUpload) {
    if (input.contextBundleError) {
      checks.push(makeCheck("fail", input.contextBundleError));
    } else if (input.contextBundle) {
      checks.push(
        makeCheck(
          "ok",
          `Local build context bundle is ready: ${formatBytes(input.contextBundle.sizeBytes)} across ${input.contextBundle.fileCount} files.`
        )
      );
    } else {
      checks.push(
        makeCheck(
          "warn",
          "Local build contexts were detected, but no bundle preview metadata was provided."
        )
      );
    }
  } else {
    checks.push(
      makeCheck("ok", "Compose file references deployable inputs without local context upload.")
    );
  }

  const steps = buildComposePlanSteps({
    requiresContextUpload: input.requiresContextUpload,
    targetServerName: resolvedServer.name
  });
  const deploymentSource: "uploaded-context" | "uploaded-compose" = input.requiresContextUpload
    ? "uploaded-context"
    : "uploaded-compose";

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    deploymentSource,
    project: scope.project,
    environment: {
      id: scope.environment.id,
      name: scope.environment.name,
      action: scope.environment.action
    },
    service: {
      id: scope.service.id,
      name: scope.service.name,
      action: scope.service.action,
      sourceType: "compose" as const
    },
    target: {
      serverId: resolvedServer.id,
      serverName: resolvedServer.name,
      serverHost: resolvedServer.host,
      composePath: input.composePath ?? null,
      contextPath: input.contextPath ?? null,
      requiresContextUpload: input.requiresContextUpload,
      localBuildContexts: input.localBuildContexts,
      contextBundle: input.contextBundle ?? null
    },
    preflightChecks: checks,
    steps,
    executeCommand: buildExecuteCommand({
      composePath: input.composePath,
      contextPath: input.contextPath,
      requiresContextUpload: input.requiresContextUpload,
      serverId: resolvedServer.id
    })
  };
}
