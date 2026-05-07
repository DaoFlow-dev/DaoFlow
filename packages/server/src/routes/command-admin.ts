import { t } from "../trpc";
import { adminAccessAssetsRouter } from "./command-admin-access-assets";
import { adminAgentApprovalRouter } from "./command-admin-agents-approvals";
import { adminManagedOperationsRouter } from "./command-admin-managed-operations";
import { adminManagedDatabaseRouter } from "./command-admin-managed-databases";
import { adminRegistryRouter } from "./command-admin-registries";
import { adminServerOperationsRouter } from "./command-admin-server-operations";
import { adminServerProjectRouter } from "./command-admin-servers-projects";
import { adminServiceRouter } from "./command-admin-services";

export const adminRouter = t.mergeRouters(
  adminAccessAssetsRouter,
  adminServerProjectRouter,
  adminServerOperationsRouter,
  adminManagedOperationsRouter,
  adminManagedDatabaseRouter,
  adminServiceRouter,
  adminRegistryRouter,
  adminAgentApprovalRouter
);
