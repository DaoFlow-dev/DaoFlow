import { TEMPORAL_WORKER_CONNECTED_DETAIL } from "./install-health";
import { runComposeCommand, type InstallerRuntime } from "./installer-lifecycle";
import type { InstallWorkflowProfile } from "./install-workflow-profile";

const TEMPORAL_CLUSTER_HEALTH_ARGS =
  "--profile temporal exec -T temporal temporal operator cluster health --address temporal:7233";

export type InstallWorkflowProfileChange = "lean-to-temporal" | "temporal-to-lean";

export interface InstallWorkflowProfilePlan {
  change: InstallWorkflowProfileChange;
  from: InstallWorkflowProfile;
  to: InstallWorkflowProfile;
  services: {
    added: string[];
    removed: string[];
  };
  preservedVolumes: string[];
}

export type InstallWorkflowRuntimeStep =
  | "removing-temporal"
  | "pulling-images"
  | "starting-temporal"
  | "waiting-for-temporal"
  | "starting-daoflow";

export type InstallWorkflowReadinessPhase = "startup" | "public-url-update";

export class InstallWorkflowRuntimeError extends Error {
  constructor(
    message: string,
    readonly code: "TEMPORAL_CLUSTER_HEALTH_TIMEOUT" | "TEMPORAL_PROFILE_CLEANUP_FAILED"
  ) {
    super(message);
  }
}

export function resolveInstallWorkflowProfileChange(input: {
  existingWorkflowProfile: InstallWorkflowProfile | null;
  workflowProfile: InstallWorkflowProfile;
}): InstallWorkflowProfileChange | null {
  const { existingWorkflowProfile, workflowProfile } = input;
  if (!existingWorkflowProfile || existingWorkflowProfile === workflowProfile) {
    return null;
  }

  return `${existingWorkflowProfile}-to-${workflowProfile}` as InstallWorkflowProfileChange;
}

export function getInstallWorkflowProfilePlan(input: {
  existingWorkflowProfile: InstallWorkflowProfile | null;
  workflowProfile: InstallWorkflowProfile;
}): InstallWorkflowProfilePlan | null {
  const change = resolveInstallWorkflowProfileChange(input);
  if (!change) return null;

  const isTemporalToLean = change === "temporal-to-lean";
  return {
    change,
    from: input.existingWorkflowProfile as InstallWorkflowProfile,
    to: input.workflowProfile,
    services: {
      added: isTemporalToLean ? [] : ["temporal-postgresql", "temporal"],
      removed: isTemporalToLean ? ["temporal-ui", "temporal", "temporal-postgresql"] : []
    },
    preservedVolumes: ["pgdata", "redisdata", "daoflow-staging", "daoflow-ssh", "temporal-pgdata"]
  };
}

export function getInstallWorkflowReadiness(input: {
  workflowProfile: InstallWorkflowProfile;
  phase: InstallWorkflowReadinessPhase;
}): {
  requiredWorkerDetail?: string;
  timeoutCode: "INSTALL_READINESS_TIMEOUT" | "TEMPORAL_WORKER_NOT_READY";
  timeoutMessage: string;
} {
  if (input.workflowProfile !== "temporal") {
    return {
      timeoutCode: "INSTALL_READINESS_TIMEOUT",
      timeoutMessage:
        input.phase === "startup"
          ? "DaoFlow did not become ready before the installer timeout."
          : "DaoFlow did not become ready after applying the exposed auth URL. Run 'docker compose logs daoflow' in the install directory and retry."
    };
  }

  return {
    requiredWorkerDetail: TEMPORAL_WORKER_CONNECTED_DETAIL,
    timeoutCode: "TEMPORAL_WORKER_NOT_READY",
    timeoutMessage:
      input.phase === "startup"
        ? "DaoFlow did not connect its Temporal execution worker before the installer timeout."
        : "DaoFlow did not reconnect its Temporal execution worker after applying the exposed auth URL. Run 'docker compose logs daoflow' in the install directory and retry."
  };
}

export function installWorkflowStepMessage(step: InstallWorkflowRuntimeStep): string {
  return {
    "removing-temporal":
      "Switching to lean: removing Temporal containers and keeping their data...",
    "pulling-images": "Pulling Docker images (this may take a minute)...",
    "starting-temporal": "Starting Temporal services...",
    "waiting-for-temporal": "Waiting for Temporal cluster readiness...",
    "starting-daoflow": "Starting DaoFlow services..."
  }[step];
}

export async function waitForTemporalClusterHealth(input: {
  runtime: Pick<InstallerRuntime, "exec" | "sleep">;
  dir: string;
  envPath: string;
  envOverrides?: Record<string, string>;
  attempts?: number;
  intervalMs?: number;
}): Promise<boolean> {
  const attempts = input.attempts ?? 30;
  const intervalMs = input.intervalMs ?? 2000;

  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      runComposeCommand({
        runtime: input.runtime,
        dir: input.dir,
        args: TEMPORAL_CLUSTER_HEALTH_ARGS,
        envPath: input.envPath,
        envOverrides: input.envOverrides
      });
      return true;
    } catch {
      if (attempt < attempts - 1) {
        await input.runtime.sleep(intervalMs);
      }
    }
  }

  return false;
}

export async function runInstallWorkflow(input: {
  runtime: Pick<InstallerRuntime, "exec" | "sleep">;
  dir: string;
  envPath: string;
  existingWorkflowProfile: InstallWorkflowProfile | null;
  workflowProfile: InstallWorkflowProfile;
  skipTemporalCleanup?: boolean;
  onStep?: (step: InstallWorkflowRuntimeStep) => void;
}): Promise<{
  imagePullFailed: boolean;
  workflowProfileChange: InstallWorkflowProfileChange | null;
}> {
  const workflowProfileChange = resolveInstallWorkflowProfileChange(input);

  if (workflowProfileChange === "temporal-to-lean" && !input.skipTemporalCleanup) {
    removeTemporalInstallServices(input);
  }

  input.onStep?.("pulling-images");
  let imagePullFailed = false;
  try {
    runComposeCommand({
      runtime: input.runtime,
      dir: input.dir,
      args: profileComposeArgs(input.workflowProfile, "pull"),
      envPath: input.envPath
    });
  } catch {
    imagePullFailed = true;
  }

  if (!input.existingWorkflowProfile) {
    try {
      runComposeCommand({
        runtime: input.runtime,
        dir: input.dir,
        args: "down -v",
        envPath: input.envPath
      });
    } catch {
      // No existing project to tear down — expected on first install.
    }
  }

  if (input.workflowProfile === "temporal") {
    input.onStep?.("starting-temporal");
    runComposeCommand({
      runtime: input.runtime,
      dir: input.dir,
      args: profileComposeArgs(input.workflowProfile, "up -d temporal"),
      envPath: input.envPath
    });

    input.onStep?.("waiting-for-temporal");
    const temporalReady = await waitForTemporalClusterHealth({
      runtime: input.runtime,
      dir: input.dir,
      envPath: input.envPath
    });
    if (!temporalReady) {
      throw new InstallWorkflowRuntimeError(
        "Temporal did not become healthy before the installer timeout. DaoFlow was not started. Run 'docker compose logs temporal' in the install directory and retry.",
        "TEMPORAL_CLUSTER_HEALTH_TIMEOUT"
      );
    }
  }

  input.onStep?.("starting-daoflow");
  runComposeCommand({
    runtime: input.runtime,
    dir: input.dir,
    args:
      input.workflowProfile === "temporal"
        ? profileComposeArgs(input.workflowProfile, "up -d daoflow")
        : "up -d",
    envPath: input.envPath
  });

  return { imagePullFailed, workflowProfileChange };
}

export function removeTemporalInstallServices(input: {
  runtime: Pick<InstallerRuntime, "exec">;
  dir: string;
  envPath: string;
  onStep?: (step: InstallWorkflowRuntimeStep) => void;
}): void {
  input.onStep?.("removing-temporal");
  try {
    runComposeCommand({
      runtime: input.runtime,
      dir: input.dir,
      args: "--profile temporal --profile temporal-ui rm --stop --force temporal temporal-postgresql temporal-ui",
      envPath: input.envPath
    });
  } catch {
    throw new InstallWorkflowRuntimeError(
      "Failed to remove Temporal containers while switching to lean. Temporal data was not deleted.",
      "TEMPORAL_PROFILE_CLEANUP_FAILED"
    );
  }
}

function profileComposeArgs(profile: InstallWorkflowProfile, args: string): string {
  return profile === "temporal" ? `--profile temporal ${args}` : args;
}
