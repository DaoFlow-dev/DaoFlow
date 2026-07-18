import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { managedDatabaseKinds } from "@daoflow/shared";
import { createManagedDatabase } from "../db/services/managed-databases";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { deleteService, getService } from "../db/services/services";
import {
  deploymentCapacityErrorMiddleware,
  getActorContext,
  t,
  throwOnDeployResultError
} from "../trpc";
import { teamScopedServiceUpdateProcedure } from "./service-scope";
import { requireActorTeamId } from "./team-scope";

const managedDatabaseKindSchema = z.enum(managedDatabaseKinds);
const managedDatabaseServiceInput = z.object({ serviceId: z.string().min(1) });

async function requireManagedDatabaseService(serviceId: string) {
  const service = await getService(serviceId);
  if (!service) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
  }
  if (!service.managedDatabase) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Service is not a managed database."
    });
  }
  return service;
}

export const adminManagedDatabaseRouter = t.router({
  createManagedDatabase: teamScopedServiceUpdateProcedure
    .use(deploymentCapacityErrorMiddleware)
    .input(
      z.object({
        kind: managedDatabaseKindSchema,
        projectId: z.string().min(1),
        environmentName: z.string().min(1).max(80).optional(),
        serverId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        databaseName: z.string().min(1).max(80).optional(),
        username: z.string().min(1).max(80).optional(),
        password: z.string().min(1).max(255).optional(),
        rootPassword: z.string().min(1).max(255).optional(),
        port: z
          .string()
          .regex(/^[0-9]{1,5}$/)
          .optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await createManagedDatabase({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });

      if (result.status === "unsupported-kind") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Unsupported database kind "${input.kind}".`
        });
      }

      return {
        service: result.service,
        deployment: {
          id: result.deployment.id,
          status: result.deployment.status,
          targetServerId: result.deployment.targetServerId
        },
        database: result.managedDatabase,
        volume: result.volume,
        backupPolicy: result.backupPolicy
      };
    }),
  setManagedDatabaseState: teamScopedServiceUpdateProcedure
    .use(deploymentCapacityErrorMiddleware)
    .input(
      managedDatabaseServiceInput.extend({
        action: z.enum(["start", "restart", "stop"])
      })
    )
    .mutation(async ({ ctx, input }) => {
      await requireManagedDatabaseService(input.serviceId);
      const result = await triggerDeploy({
        serviceId: input.serviceId,
        composeOperation: input.action === "stop" ? "down" : "up",
        trigger: "user",
        ...getActorContext(ctx)
      });
      throwOnDeployResultError(result);
      const deployment = (result as { deployment: { id: string; status: string } }).deployment;
      return {
        action: input.action,
        deployment
      };
    }),
  deleteManagedDatabase: teamScopedServiceUpdateProcedure
    .input(managedDatabaseServiceInput)
    .mutation(async ({ ctx, input }) => {
      await requireManagedDatabaseService(input.serviceId);
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteService({
        serviceId: input.serviceId,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return { deleted: true };
    })
});
