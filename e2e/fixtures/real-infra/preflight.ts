import { RealInfraArtifacts } from "./artifacts";
import { loadRealInfraConfig, realInfraConfigSummary, sensitiveConfigValues } from "./config";
import { assertPinnedRemoteMarker } from "./ssh";

export async function runRealInfraPreflight() {
  let artifacts = new RealInfraArtifacts(
    process.env.DAOFLOW_REAL_INFRA_ARTIFACT_DIR || "test-results/real-infra"
  );
  try {
    const config = loadRealInfraConfig();
    artifacts = new RealInfraArtifacts(config.artifactDir, sensitiveConfigValues(config));
    await artifacts.prepare();
    await artifacts.outcome("configuration", "passed", realInfraConfigSummary(config));
    await assertPinnedRemoteMarker(config);
    await artifacts.outcome("pinned-ssh-marker-preflight", "passed");
  } catch (error) {
    await artifacts.prepare();
    await artifacts.outcome("pinned-ssh-marker-preflight", "failed", {
      reason: error instanceof Error ? error.message : "Real-infrastructure preflight failed."
    });
    await artifacts.result("failed", { reason: "Preflight failed before any product mutation." });
    await artifacts.cleanup("skipped", { reason: "Preflight failed before cleanup was needed." });
    throw error;
  }
}

if (import.meta.main) {
  await runRealInfraPreflight();
}
