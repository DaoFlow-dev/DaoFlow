import { t } from "../trpc";
import { adminAccessAssetsRouter } from "./command-admin-access-assets";
import { adminAgentApprovalRouter } from "./command-admin-agents-approvals";
import { adminManagedOperationsRouter } from "./command-admin-managed-operations";
import { adminManagedDatabaseRouter } from "./command-admin-managed-databases";
import { adminRegistryRouter } from "./command-admin-registries";
import { adminServerOperationsRouter } from "./command-admin-server-operations";
import { adminServerMetricsRouter } from "./command-admin-server-metrics";
import { adminServerProjectRouter } from "./command-admin-servers-projects";
import { adminSshHostIdentityRouter } from "./command-admin-ssh-host-identities";
import { adminServiceRouter } from "./command-admin-services";
import { adminServiceSchedulesRouter } from "./command-admin-service-schedules";

export const adminRouter = t.mergeRouters(
  adminAccessAssetsRouter,
  adminServerProjectRouter,
  adminSshHostIdentityRouter,
  adminServerOperationsRouter,
  adminServerMetricsRouter,
  adminManagedOperationsRouter,
  adminManagedDatabaseRouter,
  adminServiceRouter,
  adminServiceSchedulesRouter,
  adminRegistryRouter,
  adminAgentApprovalRouter
);
