import { t } from "../trpc";
import { adminAgentApprovalRouter } from "./command-admin-agents-approvals";
import { adminServerProjectRouter } from "./command-admin-servers-projects";
import { adminServiceRouter } from "./command-admin-services";

export const adminRouter = t.mergeRouters(
  adminServerProjectRouter,
  adminServiceRouter,
  adminAgentApprovalRouter
);
