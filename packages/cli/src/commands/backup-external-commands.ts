import { Command } from "commander";
import { registerExternalArtifactListCommand } from "./backup-external-list";
import { registerExternalArtifactRegisterCommand } from "./backup-external-register";
import { registerExternalArtifactRestoreCommands } from "./backup-external-restore";

export function registerBackupExternalCommands(backup: Command): void {
  const external = backup
    .command("external")
    .description("Manage imported external PostgreSQL backup artifacts");

  registerExternalArtifactListCommand(external);
  registerExternalArtifactRegisterCommand(external);
  registerExternalArtifactRestoreCommands(external);
}
