import { ensureArtifactFiles } from "./artifacts";
import { loadRealInfraConfig } from "./config";

let artifactDir = process.env.DAOFLOW_REAL_INFRA_ARTIFACT_DIR || "test-results/real-infra";
try {
  artifactDir = loadRealInfraConfig().artifactDir;
} catch {
  // The preflight writer has already recorded the safe failure reason.
}
await ensureArtifactFiles(artifactDir);
