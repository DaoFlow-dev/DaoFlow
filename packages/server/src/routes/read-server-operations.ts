import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServerOperationLogs, getServerOperationsHub } from "../db/services/server-operations";
import { serverReadProcedure, t } from "../trpc";

export const serverOperationsReadRouter = t.router({
  serverOperationsHub: serverReadProcedure
    .input(
      z.object({
        serverId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ input }) => {
      const hub = await getServerOperationsHub(input.serverId, input.limit ?? 20);
      if (!hub) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }
      return hub;
    }),

  serverOperationLogs: serverReadProcedure
    .input(
      z.object({
        operationId: z.string().min(1),
        limit: z.number().int().min(1).max(500).optional()
      })
    )
    .query(async ({ input }) => {
      const result = await getServerOperationLogs(input.operationId, input.limit ?? 200);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server operation not found." });
      }
      return result;
    })
});
