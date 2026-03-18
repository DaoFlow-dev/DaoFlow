import type { DaoflowConfig } from "./config-loader";

export interface ComposeDeployCoreOptions {
  composePath: string;
  contextPath: string;
  serverId: string;
  json?: boolean;
  config?: DaoflowConfig;
}
