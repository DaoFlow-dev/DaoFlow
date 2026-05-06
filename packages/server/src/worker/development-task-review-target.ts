import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { projects } from "../db/schema/projects";

export interface DevelopmentTaskReviewTarget {
  project: typeof projects.$inferSelect;
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
}
