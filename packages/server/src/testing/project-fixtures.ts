import {
  createEnvironment,
  createProject,
  type CreateEnvironmentInput,
  type CreateProjectInput
} from "../db/services/projects";
import { createService, type CreateServiceInput } from "../db/services/services";

export const foundationOwnerRequester = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner"
} as const;

type FixtureRequester = Pick<
  CreateProjectInput,
  "requestedByUserId" | "requestedByEmail" | "requestedByRole"
>;

type ProjectFixtureInput = Omit<CreateProjectInput, keyof FixtureRequester>;

type EnvironmentFixtureInput = Omit<CreateEnvironmentInput, keyof FixtureRequester | "projectId">;

type ServiceFixtureInput = Omit<
  CreateServiceInput,
  keyof FixtureRequester | "projectId" | "environmentId"
>;

function failFixtureCreation(message: string): never {
  throw new Error(message);
}

export async function createProjectEnvironmentServiceFixture(input: {
  project: ProjectFixtureInput;
  environment: EnvironmentFixtureInput;
  service: ServiceFixtureInput;
  requester?: FixtureRequester;
}): Promise<{
  project: NonNullable<Awaited<ReturnType<typeof createProject>>["project"]>;
  environment: NonNullable<Awaited<ReturnType<typeof createEnvironment>>["environment"]>;
  service: NonNullable<Awaited<ReturnType<typeof createService>>["service"]>;
}>;

export async function createProjectEnvironmentServiceFixture(input: {
  project: ProjectFixtureInput;
  environment: EnvironmentFixtureInput;
  requester?: FixtureRequester;
}): Promise<{
  project: NonNullable<Awaited<ReturnType<typeof createProject>>["project"]>;
  environment: NonNullable<Awaited<ReturnType<typeof createEnvironment>>["environment"]>;
}>;

export async function createProjectEnvironmentServiceFixture(input: {
  project: ProjectFixtureInput;
  environment: EnvironmentFixtureInput;
  service?: ServiceFixtureInput;
  requester?: FixtureRequester;
}) {
  const requester = input.requester ?? foundationOwnerRequester;

  const projectResult = await createProject({
    ...input.project,
    ...requester
  });
  if (projectResult.status !== "ok") {
    failFixtureCreation(`Failed to create fixture project "${input.project.name}".`);
  }
  const project = projectResult.project;
  if (!project) {
    failFixtureCreation(`Fixture project "${input.project.name}" was not returned.`);
  }

  const environmentResult = await createEnvironment({
    ...input.environment,
    projectId: project.id,
    ...requester
  });
  if (environmentResult.status !== "ok") {
    failFixtureCreation(`Failed to create fixture environment "${input.environment.name}".`);
  }
  const environment = environmentResult.environment;
  if (!environment) {
    failFixtureCreation(`Fixture environment "${input.environment.name}" was not returned.`);
  }

  if (!input.service) {
    return {
      project,
      environment
    };
  }

  const serviceResult = await createService({
    ...input.service,
    projectId: project.id,
    environmentId: environment.id,
    ...requester
  });
  if (serviceResult.status !== "ok") {
    failFixtureCreation(`Failed to create fixture service "${input.service.name}".`);
  }
  const service = serviceResult.service;
  if (!service) {
    failFixtureCreation(`Fixture service "${input.service.name}" was not returned.`);
  }

  return {
    project,
    environment,
    service
  };
}
