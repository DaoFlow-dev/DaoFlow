import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { displayValue } from "../crypto";
import { environmentVariables, environments, projects } from "../schema/projects";
import { users } from "../schema/users";

const FOUNDATION_ENVIRONMENT_VARIABLE_IDS: Record<number, string> = {
  1001: "envvar_prod_public_origin",
  1002: "envvar_prod_database_password",
  1003: "envvar_staging_preview_flag"
};

function getEnvironmentVariableStatusTone(isSecret: boolean) {
  return isSecret ? "failed" : "queued";
}

function getEnvironmentVariableStatusLabel(
  isSecret: boolean,
  category: (typeof environmentVariables.$inferSelect)["category"]
) {
  if (isSecret) {
    return "Secret";
  }

  return `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
}

function getEnvironmentVariableId(row: typeof environmentVariables.$inferSelect) {
  return FOUNDATION_ENVIRONMENT_VARIABLE_IDS[row.id] ?? `envvar_${row.id}`;
}

function isSecretVariable(row: typeof environmentVariables.$inferSelect) {
  return row.isSecret === "true";
}

export async function listEnvironmentVariableInventory(input: {
  teamId: string;
  environmentId?: string;
  limit?: number;
  canRevealSecrets?: boolean;
}) {
  const filters = [eq(projects.teamId, input.teamId)];
  if (input.environmentId) {
    filters.push(eq(environmentVariables.environmentId, input.environmentId));
  }

  const rows = await db
    .select({
      variable: environmentVariables,
      environment: environments,
      project: projects,
      updatedByUser: users
    })
    .from(environmentVariables)
    .innerJoin(environments, eq(environments.id, environmentVariables.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(users, eq(users.id, environmentVariables.updatedByUserId))
    .where(and(...filters))
    .orderBy(desc(environmentVariables.createdAt))
    .limit(input.limit ?? 50);

  const variables = rows.map(({ variable, environment, project, updatedByUser }) => {
    const isSecret = isSecretVariable(variable);

    return {
      id: getEnvironmentVariableId(variable),
      environmentId: variable.environmentId,
      environmentName: environment.name,
      projectName: project.name,
      key: variable.key,
      displayValue: displayValue(
        variable.valueEncrypted,
        isSecret,
        input.canRevealSecrets ?? false
      ),
      isSecret,
      category: variable.category,
      branchPattern: variable.branchPattern,
      source: variable.source,
      secretRef: variable.secretRef,
      statusTone: getEnvironmentVariableStatusTone(isSecret),
      statusLabel: getEnvironmentVariableStatusLabel(isSecret, variable.category),
      updatedByEmail: updatedByUser?.email ?? "",
      updatedAt: variable.updatedAt.toISOString()
    };
  });

  return {
    summary: {
      totalVariables: variables.length,
      secretVariables: variables.filter((variable) => variable.isSecret).length,
      runtimeVariables: variables.filter((variable) => variable.category === "runtime").length,
      buildVariables: variables.filter((variable) => variable.category === "build").length
    },
    variables
  };
}
