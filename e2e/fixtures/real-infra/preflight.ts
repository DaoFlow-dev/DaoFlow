import { RealInfraArtifacts } from "./artifacts";
import {
  loadRealInfraConfig,
  realInfraConfigSummary,
  sensitiveConfigValues,
  type RealInfraConfig
} from "./config";
import { assertPinnedRemoteMarker } from "./ssh";

export async function runRealInfraPreflight() {
  let artifacts = new RealInfraArtifacts(
    process.env.DAOFLOW_REAL_INFRA_ARTIFACT_DIR || "test-results/real-infra"
  );
  let config: RealInfraConfig;
  try {
    config = loadRealInfraConfig();
  } catch (error) {
    await recordPreflightFailure(artifacts, "configuration", error);
    throw error;
  }

  artifacts = new RealInfraArtifacts(config.artifactDir, sensitiveConfigValues(config));
  try {
    await artifacts.prepare();
    await artifacts.outcome("configuration", "passed", realInfraConfigSummary(config));
    await assertPinnedRemoteMarker(config);
    await artifacts.outcome("pinned-ssh-marker-preflight", "passed");
  } catch (error) {
    await recordPreflightFailure(artifacts, "pinned-ssh-marker-preflight", error);
    throw error;
  }
}

async function recordPreflightFailure(
  artifacts: RealInfraArtifacts,
  phase: "configuration" | "pinned-ssh-marker-preflight",
  error: unknown
): Promise<void> {
  await artifacts.prepare();
  await artifacts.outcome(phase, "failed", {
    reason: error instanceof Error ? error.message : "Real-infrastructure preflight failed."
  });
  await artifacts.result("failed", { reason: "Preflight failed before any product mutation." });
  await artifacts.cleanup("skipped", { reason: "Preflight failed before cleanup was needed." });
}

if (import.meta.main) {
  await runRealInfraPreflight();
}
