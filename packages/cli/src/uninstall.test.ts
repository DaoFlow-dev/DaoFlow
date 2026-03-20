import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { uninstallCommand, uninstallRuntime } from "./commands/uninstall";
import { captureCommandExecution } from "./login-test-helpers";

const originalUninstallRuntime = {
  checkDocker: uninstallRuntime.checkDocker,
  exec: uninstallRuntime.exec,
  fetch: uninstallRuntime.fetch,
  fetchComposeYml: uninstallRuntime.fetchComposeYml,
  prompt: uninstallRuntime.prompt,
  sleep: uninstallRuntime.sleep
};

describe("uninstall command", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-uninstall-"));
    writeFileSync(
      join(installDir, "docker-compose.yml"),
      "services:\n  daoflow:\n    image: demo\n"
    );

    uninstallRuntime.exec = (command) => {
      if (command.includes('docker ps --filter "ancestor=*daoflow*"')) {
        return `com.docker.compose.project.working_dir=${installDir},com.example=1\n`;
      }

      if (command === "docker compose down --remove-orphans") {
        return "";
      }

      throw new Error(`Unexpected exec: ${command}`);
    };
    uninstallRuntime.prompt = () => Promise.resolve("y");
  });

  afterEach(() => {
    uninstallRuntime.checkDocker = originalUninstallRuntime.checkDocker;
    uninstallRuntime.exec = originalUninstallRuntime.exec;
    uninstallRuntime.fetch = originalUninstallRuntime.fetch;
    uninstallRuntime.fetchComposeYml = originalUninstallRuntime.fetchComposeYml;
    uninstallRuntime.prompt = originalUninstallRuntime.prompt;
    uninstallRuntime.sleep = originalUninstallRuntime.sleep;
    rmSync(installDir, { recursive: true, force: true });
  });

  test("auto-discovers the install directory before stopping services", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(uninstallCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "uninstall", "--yes", "--json"]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      directory: installDir,
      dataRemoved: false
    });
  });
});
