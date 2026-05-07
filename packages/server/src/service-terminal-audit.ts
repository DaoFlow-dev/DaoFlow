import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import type { ResolvedServiceRuntime } from "./db/services/service-runtime";
import type { AuthorizedRequestActor } from "./routes/request-auth";

function normalizeActorType(actor: AuthorizedRequestActor): string {
  return actor.auth.method === "api-token" ? actor.auth.principal.type : "user";
}

export async function recordServiceTerminalAudit(input: {
  actor: AuthorizedRequestActor;
  runtime: ResolvedServiceRuntime;
  shell: "bash" | "sh";
  outcome: "success" | "failed";
  action: "service.terminal.open" | "service.terminal.close";
  summary: string;
}) {
  await db.insert(auditEntries).values({
    actorType: normalizeActorType(input.actor),
    actorId: input.actor.auth.principal.id,
    actorEmail: input.actor.session.user.email,
    actorRole: input.actor.role,
    targetResource: `service/${input.runtime.service.id}`,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: "terminal:open",
    outcome: input.outcome,
    metadata: {
      resourceType: "service",
      resourceId: input.runtime.service.id,
      serviceName: input.runtime.service.name,
      targetServerId: input.runtime.server.id,
      targetServerName: input.runtime.server.name,
      shell: input.shell
    }
  });
}
