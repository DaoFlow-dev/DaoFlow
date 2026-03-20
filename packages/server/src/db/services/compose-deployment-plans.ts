import { and, eq } from "drizzle-orm";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { buildComposeEnvPlanDiagnostics } from "../../compose-env-plan";
import { mergeComposeDocuments } from "../../compose-merge";
import { normalizeComposeProfiles } from "../../compose-source";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { resolveComposeDeploymentEnvEntries } from "./compose-env";
import { resolveTeamIdForUser } from "./teams";

type PlanCheckStatus = "ok" | "warn" | "fail";
type ScopeAction = "reuse" | "create";

function makeCheck(status: PlanCheckStatus, detail: string) {
  return { status, detail };
}

function summarizeComposeEnvPlanDiagnostics(input: {
  branch: string;
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>;
}) {
  const { diagnostics } = input;
  const variableLabel =
    diagnostics.composeEnv.counts.environmentVariables === 1 ? "variable" : "variables";
  const branchScopedLabel =
    diagnostics.matchedBranchOverrideCount === 1 ? "branch-scoped match" : "branch-scoped matches";

  return `Compose env plan resolved ${diagnostics.composeEnv.counts.total} entries for branch ${input.branch}: ${diagnostics.composeEnv.counts.repoDefaults} repo defaults, ${diagnostics.composeEnv.counts.environmentVariables} DaoFlow-managed ${variableLabel}, ${diagnostics.composeEnv.counts.overriddenRepoDefaults} repo-default overrides, ${diagnostics.matchedBranchOverrideCount} ${branchScopedLabel}.`;
}

function buildComposeEnvPlanChecks(
  diagnostics: ReturnType<typeof buildComposeEnvPlanDiagnostics>
): Array<{ status: PlanCheckStatus; detail: string }> {
  const checks: Array<{ status: PlanCheckStatus; detail: string }> = [
    makeCheck("ok", summarizeComposeEnvPlanDiagnostics({ branch: diagnostics.branch, diagnostics }))
  ];

  for (const warning of diagnostics.interpolation.warnings) {
    checks.push(makeCheck("warn", warning));
  }

  for (const issue of diagnostics.interpolation.unresolved) {
    checks.push(makeCheck(issue.severity, issue.detail));
  }

  if (diagnostics.interpolation.status === "ok") {
    checks.push(
      makeCheck(
        "ok",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.totalReferences} references with no unresolved variables.`
      )
    );
  } else if (diagnostics.interpolation.status === "warn") {
    checks.push(
      makeCheck(
        "warn",
        `Compose interpolation analysis found ${diagnostics.interpolation.summary.optionalMissing} unresolved optional references.`
      )
    );
  } else if (diagnostics.interpolation.status === "unavailable") {
    checks.push(
      makeCheck(
        "warn",
        "Compose interpolation analysis is unavailable for this plan; only env precedence diagnostics are shown."
      )
    );
  }

  return checks;
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

function mergeComposePlanContents(
  composeFiles: Array<{ path: string; contents: string }>
): Record<string, unknown> {
  return mergeComposeDocuments(
    composeFiles.map(
      (composeFile) =>
        ((parseYaml(composeFile.contents) as Record<string, unknown> | null) ??
          {}) satisfies Record<string, unknown>
    )
  );
}

function stringifyMergedComposeDoc(doc: Record<string, unknown>): string {
  return stringifyYaml(doc);
}

function validateRequestedComposeProfiles(
  doc: Record<string, unknown>,
  composeProfiles: string[]
): string[] {
  if (composeProfiles.length === 0) {
    return [];
  }

  const services =
    doc.services && typeof doc.services === "object" && !Array.isArray(doc.services)
      ? (doc.services as Record<string, unknown>)
      : {};
  const availableProfiles = new Set<string>();

  for (const value of Object.values(services)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const profiles = (value as Record<string, unknown>).profiles;
    if (!Array.isArray(profiles)) {
      continue;
    }

    for (const profile of profiles) {
      if (typeof profile === "string" && profile.trim().length > 0) {
        availableProfiles.add(profile.trim());
      }
    }
  }

  return composeProfiles.filter((profile) => !availableProfiles.has(profile));
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
      project: {
        id: null,
        name: input.projectName,
        action: "create" as const,
        defaultBranch: null as string | null
      },
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
      project: {
        id: project.id,
        name: project.name,
        action: "reuse" as const,
        defaultBranch: project.defaultBranch
      },
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
    project: {
      id: project.id,
      name: project.name,
      action: "reuse" as const,
      defaultBranch: project.defaultBranch
    },
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
  composeFileCount: number;
  composeProfiles: string[];
}) {
  const freezeLabel =
    input.composeFileCount > 1
      ? "Freeze the compose file set and local build-context manifest"
      : "Freeze the compose file and local build-context manifest";
  const uploadLabel =
    input.composeFileCount > 1
      ? "Upload the staged archive and compose file set to the DaoFlow control plane"
      : "Upload the staged archive and compose file to the DaoFlow control plane";
  const composeCommand =
    input.composeProfiles.length > 0
      ? `Run docker compose up -d --build on ${input.targetServerName} with profiles ${input.composeProfiles.join(", ")}`
      : `Run docker compose up -d --build on ${input.targetServerName}`;

  if (input.requiresContextUpload) {
    return [
      freezeLabel,
      "Bundle the local build context while respecting .dockerignore rules",
      uploadLabel,
      "Dispatch the uploaded compose workspace to the execution plane",
      composeCommand,
      "Record health checks and the final deployment outcome"
    ];
  }

  return [
    input.composeFileCount > 1
      ? "Freeze the compose file set for an immutable deployment record"
      : "Freeze the compose file for an immutable deployment record",
    input.composeFileCount > 1
      ? "Stage the compose file set in durable control-plane storage"
      : "Stage the compose file in durable control-plane storage",
    "Dispatch the compose deployment to the execution plane",
    composeCommand,
    "Record health checks and the final deployment outcome"
  ];
}

function buildExecuteCommand(input: {
  composePath?: string;
  composeFiles: string[];
  composeProfiles: string[];
  contextPath?: string;
  requiresContextUpload: boolean;
  serverId: string;
}) {
  const [primaryComposePath, ...overrideComposeFiles] = input.composeFiles;
  const command = [
    "daoflow deploy",
    `--compose ${primaryComposePath ?? input.composePath ?? "<compose-path>"}`,
    `--server ${input.serverId}`
  ];

  if (input.requiresContextUpload || (input.contextPath && input.contextPath !== ".")) {
    command.push(`--context ${input.contextPath ?? "."}`);
  }

  for (const composeFile of overrideComposeFiles) {
    command.push(`--compose-override ${composeFile}`);
  }

  for (const profile of input.composeProfiles) {
    command.push(`--profile ${profile}`);
  }

  command.push("--yes");
  return command.join(" ");
}

export interface ComposeDeploymentPlanInput {
  composeContent: string;
  composeFiles?: Array<{
    path: string;
    contents: string;
  }>;
  composeProfiles?: string[];
  composePath?: string;
  contextPath?: string;
  repoDefaultContent?: string;
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
  const composeFileSet =
    input.composeFiles && input.composeFiles.length > 0
      ? input.composeFiles.filter(
          (composeFile) =>
            composeFile.path.trim().length > 0 && composeFile.contents.trim().length > 0
        )
      : input.composeContent.trim().length > 0
        ? [
            {
              path: input.composePath ?? "compose.yaml",
              contents: input.composeContent
            }
          ]
        : [];

  if (composeFileSet.length === 0) {
    throw new Error("Compose content is required.");
  }

  const composeProfiles = normalizeComposeProfiles(input.composeProfiles);
  const mergedComposeDoc = mergeComposePlanContents(composeFileSet);
  const unsupportedProfiles = validateRequestedComposeProfiles(mergedComposeDoc, composeProfiles);
  const mergedComposeContent = input.composeFiles?.length
    ? stringifyMergedComposeDoc(mergedComposeDoc)
    : input.composeContent.trim();

  const resolvedServer = await resolveServer(input.serverRef);
  const teamId = await resolveTeamIdForUser(input.requestedByUserId);

  const derivedName = deriveStackName(mergedComposeContent, "uploaded-compose");
  const projectName = sanitizeName(derivedName, "uploaded-compose");
  const environmentName = "production";
  const serviceName = sanitizeName(derivedName, projectName);
  const scope = await resolveExistingScope({
    projectName,
    environmentName,
    serviceName
  });
  const branch = scope.project.defaultBranch ?? "main";
  const deploymentEntries = scope.environment.id
    ? await resolveComposeDeploymentEnvEntries({
        environmentId: scope.environment.id,
        branch
      })
    : [];
  const composeEnvPlan = buildComposeEnvPlanDiagnostics({
    branch,
    composeContent: mergedComposeContent,
    repoDefaultContent: input.repoDefaultContent,
    deploymentEntries
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
  checks.push(...buildComposeEnvPlanChecks(composeEnvPlan));
  if (composeFileSet.length > 1) {
    checks.push(
      makeCheck(
        "ok",
        `Compose file order is frozen as: ${composeFileSet.map((composeFile) => composeFile.path).join(" -> ")}.`
      )
    );
  }
  if (composeProfiles.length > 0) {
    checks.push(
      unsupportedProfiles.length === 0
        ? makeCheck("ok", `Compose execution will enable profiles: ${composeProfiles.join(", ")}.`)
        : makeCheck(
            "fail",
            `Compose profiles not found in the staged compose files: ${unsupportedProfiles.join(", ")}.`
          )
    );
  }

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
    targetServerName: resolvedServer.name,
    composeFileCount: composeFileSet.length,
    composeProfiles
  });
  const deploymentSource: "uploaded-context" | "uploaded-compose" = input.requiresContextUpload
    ? "uploaded-context"
    : "uploaded-compose";

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    deploymentSource,
    project: {
      id: scope.project.id,
      name: scope.project.name,
      action: scope.project.action
    },
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
    composeEnvPlan,
    target: {
      serverId: resolvedServer.id,
      serverName: resolvedServer.name,
      serverHost: resolvedServer.host,
      composePath: composeFileSet[0]?.path ?? input.composePath ?? null,
      composeFiles: composeFileSet.map((composeFile) => composeFile.path),
      composeProfiles,
      contextPath: input.contextPath ?? null,
      requiresContextUpload: input.requiresContextUpload,
      localBuildContexts: input.localBuildContexts,
      contextBundle: input.contextBundle ?? null
    },
    preflightChecks: checks,
    steps,
    executeCommand: buildExecuteCommand({
      composePath: input.composePath,
      composeFiles: composeFileSet.map((composeFile) => composeFile.path),
      composeProfiles,
      contextPath: input.contextPath,
      requiresContextUpload: input.requiresContextUpload,
      serverId: resolvedServer.id
    })
  };
}
