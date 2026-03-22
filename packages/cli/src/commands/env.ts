import { Command } from "commander";
import { registerEnvReadCommands } from "./env-read-commands";
import { registerEnvWriteCommands } from "./env-write-commands";

export function envCommand(): Command {
  const cmd = new Command("env").description("Manage environment variables");
  registerEnvReadCommands(cmd);
  registerEnvWriteCommands(cmd);
  return cmd;
}
