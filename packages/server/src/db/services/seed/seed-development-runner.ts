import { sandboxRunnerProfiles } from "../../schema/development-tasks";
import {
  DEFAULT_BOXLITE_RUNNER_PROFILE_ID,
  DEFAULT_CODEX_AUTH_MODE,
  DEFAULT_CODEX_CONFIG_TEMPLATE,
  DEFAULT_DEVELOPMENT_TASK_VALIDATION_COMMANDS,
  DEFAULT_HOST_RUNNER_PROFILE_ID,
  defaultBoxLiteRunnerMetadata,
  defaultHostRunnerMetadata
} from "../default-development-runner";
import { daysBefore } from "./seed-helpers";
import type { SeedTransaction } from "./seed-types";

export async function seedDevelopmentRunner(
  tx: SeedTransaction,
  input?: { defaultServerId?: string | null }
) {
  await tx
    .insert(sandboxRunnerProfiles)
    .values({
      id: DEFAULT_HOST_RUNNER_PROFILE_ID,
      name: "Host Docker Default",
      provider: "host_docker",
      serverId: input?.defaultServerId ?? null,
      image: "ghcr.io/daoflow/codex-runner:latest",
      cpuLimit: 2,
      memoryLimitMb: 4096,
      diskLimitMb: 20480,
      networkPolicy: "default-egress",
      allowedCommands: DEFAULT_DEVELOPMENT_TASK_VALIDATION_COMMANDS,
      validationCommands: DEFAULT_DEVELOPMENT_TASK_VALIDATION_COMMANDS,
      timeoutMinutes: 60,
      codexAuthMode: DEFAULT_CODEX_AUTH_MODE,
      codexConfigTemplate: DEFAULT_CODEX_CONFIG_TEMPLATE,
      status: input?.defaultServerId ? "enabled" : "disabled",
      metadata: defaultHostRunnerMetadata({ hostServerDefault: Boolean(input?.defaultServerId) }),
      createdAt: daysBefore(1),
      updatedAt: daysBefore(1)
    })
    .onConflictDoNothing();

  await tx
    .insert(sandboxRunnerProfiles)
    .values({
      id: DEFAULT_BOXLITE_RUNNER_PROFILE_ID,
      name: "Sandbank BoxLite Default",
      provider: "sandbank_boxlite",
      serverId: input?.defaultServerId ?? null,
      image: "ghcr.io/daoflow/codex-runner:latest",
      cpuLimit: 2,
      memoryLimitMb: 4096,
      diskLimitMb: 20480,
      networkPolicy: "default-egress",
      allowedCommands: DEFAULT_DEVELOPMENT_TASK_VALIDATION_COMMANDS,
      validationCommands: DEFAULT_DEVELOPMENT_TASK_VALIDATION_COMMANDS,
      timeoutMinutes: 60,
      codexAuthMode: DEFAULT_CODEX_AUTH_MODE,
      codexConfigTemplate: DEFAULT_CODEX_CONFIG_TEMPLATE,
      status: "disabled",
      metadata: defaultBoxLiteRunnerMetadata({
        hostServerDefault: Boolean(input?.defaultServerId)
      }),
      createdAt: daysBefore(1),
      updatedAt: daysBefore(1)
    })
    .onConflictDoNothing();
}
