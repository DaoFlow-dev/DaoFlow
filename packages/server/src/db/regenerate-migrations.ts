import { rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../..");
const drizzleDir = path.join(rootDir, "drizzle");

const phases = [
  {
    config: "drizzle.config.foundation.ts",
    name: "foundation_identity"
  },
  {
    config: "drizzle.config.control-plane.ts",
    name: "core_control_plane"
  },
  {
    config: "drizzle.config.ts",
    name: "auxiliary_surfaces"
  }
] as const;

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: rootDir,
      env: process.env,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code ?? "unknown"}`));
    });
  });
}

async function main() {
  await rm(drizzleDir, { force: true, recursive: true });

  for (const phase of phases) {
    await run("bunx", ["drizzle-kit", "generate", "--config", phase.config, "--name", phase.name]);
  }

  console.log(`Regenerated ${phases.length} migration phases in ${drizzleDir}`);
}

void main();
