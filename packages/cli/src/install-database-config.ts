import type { CommandActionContext } from "./command-action";
import type { DatabasePasswordMode } from "./install-config-types";
import type { InstallerRuntime } from "./installer-lifecycle";
import type { InstallWorkflowProfile } from "./install-workflow-profile";

export async function collectNewInstallDatabasePasswords(input: {
  runtime: Pick<InstallerRuntime, "prompt">;
  ctx: CommandActionContext;
  workflowProfile: InstallWorkflowProfile;
}): Promise<{
  databasePasswordMode: DatabasePasswordMode;
  postgresPassword?: string;
  temporalPostgresPassword?: string;
}> {
  const choice = await input.runtime.prompt(
    "Database passwords - auto-generate or enter manually? (auto/manual)",
    "auto"
  );
  if (choice.toLowerCase() !== "manual") {
    console.error("  Secure passwords will be auto-generated.");
    return { databasePasswordMode: "auto-generated" };
  }

  const postgresPassword = await input.runtime.prompt("Postgres password (daoflow DB)");
  const temporalPostgresPassword =
    input.workflowProfile === "temporal"
      ? await input.runtime.prompt("Postgres password (temporal DB)")
      : undefined;
  if (!postgresPassword || (input.workflowProfile === "temporal" && !temporalPostgresPassword)) {
    input.ctx.fail(
      input.workflowProfile === "temporal"
        ? "Both database passwords are required."
        : "A Postgres password is required."
    );
  }

  return {
    databasePasswordMode: "manual",
    postgresPassword,
    temporalPostgresPassword
  };
}
