import { normalizeCliInput } from "../command-helpers";
import type {
  ProjectDetailsOutput,
  ProjectEnvironmentItem,
  ProjectListItem
} from "../trpc-contract";

export function collectValues(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

export function normalizeRepeatedValues(values: string[] | undefined, field: string) {
  return (values ?? []).map((value) => normalizeCliInput(value, field)).filter(Boolean);
}

export function summarizeProject(project: ProjectListItem | ProjectDetailsOutput) {
  return {
    id: project.id,
    name: project.name,
    description: project.description,
    repoFullName: project.repoFullName,
    repoUrl: project.repoUrl,
    sourceType: project.sourceType,
    status: project.status,
    statusTone: project.statusTone,
    defaultBranch: project.defaultBranch,
    autoDeploy: project.autoDeploy,
    composeFiles: project.composeFiles,
    composeProfiles: project.composeProfiles,
    environmentCount: project.environmentCount,
    serviceCount: project.serviceCount,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt
  };
}

export function summarizeEnvironment(environment: ProjectEnvironmentItem) {
  return {
    id: environment.id,
    projectId: environment.projectId,
    name: environment.name,
    status: environment.status,
    statusTone: environment.statusTone,
    targetServerId: environment.targetServerId,
    composeFiles: environment.composeFiles,
    composeProfiles: environment.composeProfiles,
    serviceCount: environment.serviceCount,
    createdAt: environment.createdAt,
    updatedAt: environment.updatedAt
  };
}
