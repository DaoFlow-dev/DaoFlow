import { and, eq } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import type { AppRole } from "@daoflow/shared";
import { db } from "../db/connection";
import { projects } from "../db/schema/projects";
import { serviceSchedules } from "../db/schema/service-schedules";
import {
  environmentBelongsToTeam,
  getServiceForTeam,
  projectBelongsToTeam,
  recordDeniedServiceAccess,
  type ServiceAccessActor
} from "../db/services/service-access";
import { resolveTeamIdForUser } from "../db/services/teams";
import { adminProcedure, serviceUpdateProcedure } from "../trpc";

type ScopedContext = {
  session: { user: { id: string; email: string } };
  auth: { role: AppRole; method?: string };
};

function inputRecord(rawInput: unknown): Record<string, unknown> {
  return rawInput && typeof rawInput === "object" ? (rawInput as Record<string, unknown>) : {};
}

export function serviceAccessActor(ctx: ScopedContext): ServiceAccessActor {
  return {
    id: ctx.session.user.id,
    email: ctx.session.user.email,
    role: ctx.auth.role,
    actorType: ctx.auth.method === "api-token" ? "token" : "user"
  };
}

async function requireTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }
  return teamId;
}

async function assertServiceInputScope(input: {
  rawInput: unknown;
  ctx: ScopedContext;
  action: string;
  permissionScope: string;
}) {
  const record = inputRecord(input.rawInput);
  const teamId = await requireTeamId(input.ctx.session.user.id);
  const actor = serviceAccessActor(input.ctx);
  const serviceId = typeof record.serviceId === "string" ? record.serviceId : "";

  if (serviceId) {
    const service = await getServiceForTeam({
      serviceId,
      teamId,
      actor,
      action: input.action,
      permissionScope: input.permissionScope
    });
    if (!service) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
    }
  }

  const scheduleId = typeof record.scheduleId === "string" ? record.scheduleId : "";
  if (scheduleId) {
    const [schedule] = await db
      .select({ serviceId: serviceSchedules.serviceId, projectId: serviceSchedules.projectId })
      .from(serviceSchedules)
      .innerJoin(projects, eq(projects.id, serviceSchedules.projectId))
      .where(and(eq(serviceSchedules.id, scheduleId), eq(projects.teamId, teamId)))
      .limit(1);
    if (!schedule) {
      await recordDeniedServiceAccess({
        actor,
        action: input.action,
        permissionScope: input.permissionScope
      });
      throw new TRPCError({ code: "NOT_FOUND", message: "Service schedule not found." });
    }
  }

  const projectId = typeof record.projectId === "string" ? record.projectId : "";
  const environmentId = typeof record.environmentId === "string" ? record.environmentId : "";

  if (projectId && !(await projectBelongsToTeam(projectId, teamId))) {
    await recordDeniedServiceAccess({
      projectId,
      actor,
      action: input.action,
      permissionScope: input.permissionScope
    });
    throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
  }

  if (environmentId) {
    const environment = await environmentBelongsToTeam(environmentId, teamId);
    if (!environment || (projectId && environment.projectId !== projectId)) {
      await recordDeniedServiceAccess({
        projectId: projectId || undefined,
        environmentId,
        actor,
        action: input.action,
        permissionScope: input.permissionScope
      });
      throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
    }
  }
}

export const teamScopedServiceUpdateProcedure = serviceUpdateProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    await assertServiceInputScope({
      rawInput: await getRawInput(),
      ctx,
      action: "service.mutation.denied",
      permissionScope: "service:update"
    });
    return next({ ctx });
  }
);

export const teamScopedAdminServiceProcedure = adminProcedure.use(
  async ({ ctx, getRawInput, next }) => {
    await assertServiceInputScope({
      rawInput: await getRawInput(),
      ctx,
      action: "service.admin-mutation.denied",
      permissionScope: "service:update"
    });
    return next({ ctx });
  }
);
