import { z } from "zod";

/** Reusable Zod input for list endpoints that accept an optional `limit` param. */
export const limitInput = (max: number) =>
  z.object({
    limit: z.number().int().min(1).max(max).optional()
  });

/** `limitInput` with an optional status filter. */
export const statusLimitInput = <T extends [string, ...string[]]>(statuses: T, maxLimit: number) =>
  z.object({
    status: z.enum(statuses).optional(),
    limit: z.number().int().min(1).max(maxLimit).optional()
  });
