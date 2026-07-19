import { spawn } from "node:child_process";
import { RealInfraArtifacts } from "./artifacts";
import { loadRealInfraConfig } from "./config";

const [label, ...command] = process.argv.slice(2);
let artifactDir = process.env.DAOFLOW_REAL_INFRA_ARTIFACT_DIR || "test-results/real-infra";
try {
  artifactDir = loadRealInfraConfig().artifactDir;
} catch {
  // The preflight command owns the detailed redacted failure report.
}

if (!label || command.length === 0) {
  process.exit(2);
}

const artifacts = new RealInfraArtifacts(artifactDir);
const child = spawn(command[0]!, command.slice(1), { env: process.env, stdio: "ignore" });
const timer = setTimeout(() => {
  child.kill("SIGTERM");
  setTimeout(() => child.kill("SIGKILL"), 5_000).unref();
}, 600_000);

child.once("error", async () => {
  clearTimeout(timer);
  await artifacts.outcome(label, "failed", { reason: "Command could not start." });
  process.exit(1);
});

child.once("close", async (code) => {
  clearTimeout(timer);
  const passed = code === 0;
  await artifacts.outcome(label, passed ? "passed" : "failed", { exitCode: code ?? 1 });
  process.exit(passed ? 0 : 1);
});
