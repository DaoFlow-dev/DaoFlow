/* global process */

import { expect, test } from "bun:test";

process.env.DATABASE_URL ??= "postgresql://readiness:readiness@127.0.0.1:5432/readiness";

test("keeps read, planning, and audited command procedures distinct", async () => {
  const [{ appRouter }, { apiProcedureAccess }] = await Promise.all([
    import("../../packages/server/src/router.ts"),
    import("../external-contract-metadata.ts")
  ]);
  const procedures = appRouter._def.procedures;

  expect(procedures.health._def.type).toBe("query");
  expect(procedures.deploymentPlan._def.type).toBe("query");
  expect(apiProcedureAccess.health.laneOverride ?? "read").toBe("read");
  expect(apiProcedureAccess.deploymentPlan.laneOverride).toBe("planning");
  expect(procedures.triggerDeploy._def.type).toBe("mutation");
  expect(apiProcedureAccess.triggerDeploy.laneOverride ?? "command").toBe("command");
  expect(procedures.triggerDeploy._def.meta?.commandAudit).toBeDefined();
});
