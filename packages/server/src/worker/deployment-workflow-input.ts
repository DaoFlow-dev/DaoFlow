export interface DeploymentWorkflowInput {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
}
