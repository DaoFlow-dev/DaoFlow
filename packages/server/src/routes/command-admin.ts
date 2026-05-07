import { t } from "../trpc";
import { adminAgentApprovalRouter } from "./command-admin-agents-approvals";
import { adminManagedOperationsRouter } from "./command-admin-managed-operations";
import { adminRegistryRouter } from "./command-admin-registries";
import { adminServerOperationsRouter } from "./command-admin-server-operations";
import { adminServerProjectRouter } from "./command-admin-servers-projects";
import { adminServiceRouter } from "./command-admin-services";

export const adminRouter = t.mergeRouters(
  adminServerProjectRouter,
  adminServerOperationsRouter,
  adminManagedOperationsRouter,
  adminServiceRouter,
  adminRegistryRouter,
  adminAgentApprovalRouter
);
