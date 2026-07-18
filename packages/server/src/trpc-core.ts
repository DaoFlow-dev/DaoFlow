import { initTRPC } from "@trpc/server";
import type { Context } from "./context";
import type { CommandAuditContract } from "./db/services/command-audit";

export interface ProcedureMeta {
  commandAudit?: CommandAuditContract;
}

export const t = initTRPC
  .context<Context>()
  .meta<ProcedureMeta>()
  .create({
    errorFormatter({ shape, error }) {
      const cause =
        error.cause && typeof error.cause === "object"
          ? (error.cause as unknown as Record<string, unknown>)
          : null;

      return cause
        ? {
            ...shape,
            data: {
              ...shape.data,
              cause
            }
          }
        : shape;
    }
  });
