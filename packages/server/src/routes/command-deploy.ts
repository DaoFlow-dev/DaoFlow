import { t } from "../trpc";
import { deployEnvironmentCommandRouter } from "./command-deploy-environment";
import { deployExecutionCommandRouter } from "./command-deploy-execution";
import { deployLifecycleCommandRouter } from "./command-deploy-lifecycle";

export const deployRouter = t.mergeRouters(
  deployExecutionCommandRouter,
  deployEnvironmentCommandRouter,
  deployLifecycleCommandRouter
);
