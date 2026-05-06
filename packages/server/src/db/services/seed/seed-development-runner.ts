import { sandboxRunnerProfiles } from "../../schema/development-tasks";
import { daysBefore } from "./seed-helpers";
import type { SeedTransaction } from "./seed-types";

export async function seedDevelopmentRunner(
  tx: SeedTransaction,
  input?: { defaultServerId?: string | null }
) {
  await tx
    .insert(sandboxRunnerProfiles)
    .values({
      id: "runner_profile_host_default",
      name: "Host Docker Default",
      provider: "host_docker",
      serverId: input?.defaultServerId ?? null,
      image: "ghcr.io/daoflow/codex-runner:latest",
      cpuLimit: 2,
      memoryLimitMb: 4096,
      diskLimitMb: 20480,
      networkPolicy: "default-egress",
      allowedCommands: [],
      validationCommands: [
        "bun run format",
        "bun run test:unit",
        "bun run lint",
        "bun run typecheck",
        "bun run contracts:check"
      ],
      timeoutMinutes: 60,
      codexAuthMode: "api_key",
      status: "disabled",
      metadata: {
        defaultTarget: "registered-host",
        sandbankProvider: "host_docker",
        laterProvider: "sandbank_boxlite",
        laterPackage: "@sandbank.dev/boxlite"
      },
      createdAt: daysBefore(1),
      updatedAt: daysBefore(1)
    })
    .onConflictDoNothing();
}
