import { Command } from "commander";
import { registerEnvDeleteCommand, registerEnvSetCommand } from "./env-mutation-commands";
import { registerEnvPushCommand } from "./env-push-command";

export function registerEnvWriteCommands(cmd: Command): void {
  registerEnvPushCommand(cmd);
  registerEnvSetCommand(cmd);
  registerEnvDeleteCommand(cmd);
}
