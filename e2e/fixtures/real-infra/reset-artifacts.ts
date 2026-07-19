import { RealInfraArtifacts } from "./artifacts";
import { loadRealInfraConfig, sensitiveConfigValues } from "./config";

const config = loadRealInfraConfig();
const artifacts = new RealInfraArtifacts(config.artifactDir, sensitiveConfigValues(config));
await artifacts.reset();
