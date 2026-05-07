import { t } from "../trpc";
import { adminAgentApprovalRouter } from "./command-admin-agents-approvals";
import { adminRegistryRouter } from "./command-admin-registries";
import { adminServerOperationsRouter } from "./command-admin-server-operations";
import { adminServerProjectRouter } from "./command-admin-servers-projects";
import { adminServiceRouter } from "./command-admin-services";

export const adminRouter = t.mergeRouters(
  adminServerProjectRouter,
  adminServerOperationsRouter,
  adminServiceRouter,
  adminRegistryRouter,
  adminAgentApprovalRouter
);
