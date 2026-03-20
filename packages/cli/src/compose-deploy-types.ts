import type { ComposeFileInput } from "./compose-file-set";
import type { DaoflowConfig } from "./config-loader";

export interface ComposeDeployCoreOptions {
  composePath: string;
  composeOverrides?: string[];
  composeFiles?: ComposeFileInput[];
  composeProfiles?: string[];
  contextPath: string;
  serverId: string;
  json?: boolean;
  config?: DaoflowConfig;
}
