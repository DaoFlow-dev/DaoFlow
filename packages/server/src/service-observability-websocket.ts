import type { Server, ServerWebSocket } from "bun";
import { db } from "./db/connection";
import { auditEntries } from "./db/schema/audit";
import { resolveServiceRuntime, type ResolvedServiceRuntime } from "./db/services/service-runtime";
import { authorizeRequest, type AuthorizedRequestActor } from "./routes/request-auth";
import {
  startServiceLogStream,
  startServiceTerminal,
  type ServiceStreamHandle,
  type ServiceTerminalHandle
} from "./worker/service-observability";

type LogsSocketData = {
  kind: "logs";
  runtime: ResolvedServiceRuntime;
  tail: number;
  handle?: ServiceStreamHandle;
};

type TerminalSocketData = {
  kind: "terminal";
  runtime: ResolvedServiceRuntime;
  shell: "bash" | "sh";
  actor: AuthorizedRequestActor;
  handle?: ServiceTerminalHandle;
};

type ObservabilitySocketData = LogsSocketData | TerminalSocketData;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function normalizeActorType(actor: AuthorizedRequestActor): string {
  return actor.auth.method === "api-token" ? actor.auth.principal.type : "user";
}

async function recordTerminalAudit(input: {
  actor: AuthorizedRequestActor;
  runtime: ResolvedServiceRuntime;
  shell: "bash" | "sh";
  outcome: "success" | "failed";
  action: "service.terminal.open" | "service.terminal.close";
  summary: string;
}) {
  const targetResource = `service/${input.runtime.service.id}`;
  const actorType = normalizeActorType(input.actor);

  await db.insert(auditEntries).values({
    actorType,
    actorId: input.actor.auth.principal.id,
    actorEmail: input.actor.session.user.email,
    actorRole: input.actor.role,
    targetResource,
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

async function resolveWebSocketRuntime(
  serviceId: string
): Promise<{ ok: true; runtime: ResolvedServiceRuntime } | { ok: false; response: Response }> {
  const runtimeResult = await resolveServiceRuntime(serviceId);
  if (runtimeResult.status !== "ok") {
    const status = runtimeResult.status === "not_found" ? 404 : 409;
    return {
      ok: false,
      response: jsonResponse(
        {
          ok: false,
          error: runtimeResult.message,
          code: runtimeResult.status.toUpperCase()
        },
        status
      )
    };
  }

  return { ok: true, runtime: runtimeResult.runtime };
}

export async function handleServiceObservabilityWebSocketUpgrade(
  req: Request,
  server: Server<ObservabilitySocketData>
): Promise<Response | undefined | null> {
  const url = new URL(req.url);
  if (url.pathname !== "/ws/container-logs" && url.pathname !== "/ws/docker-terminal") {
    return null;
  }

  if (url.pathname === "/ws/container-logs") {
    const authResult = await authorizeRequest({
      headers: req.headers,
      requiredScopes: ["logs:read"]
    });
    if (!authResult.ok) {
      return jsonResponse(authResult.body, authResult.status);
    }

    const serviceId = url.searchParams.get("serviceId")?.trim() ?? "";
    if (!serviceId) {
      return jsonResponse({ ok: false, error: "Missing serviceId", code: "INVALID_REQUEST" }, 400);
    }

    const runtimeResult = await resolveWebSocketRuntime(serviceId);
    if (!runtimeResult.ok) {
      return runtimeResult.response;
    }

    const tail = Math.min(
      Math.max(Number.parseInt(url.searchParams.get("tail") ?? "200", 10) || 200, 1),
      2000
    );
    const upgraded = server.upgrade(req, {
      data: {
        kind: "logs",
        runtime: runtimeResult.runtime,
        tail
      } satisfies LogsSocketData
    });

    return upgraded ? undefined : jsonResponse({ ok: false, error: "Upgrade failed" }, 500);
  }

  const authResult = await authorizeRequest({
    headers: req.headers,
    requiredScopes: ["terminal:open"]
  });
  if (!authResult.ok) {
    return jsonResponse(authResult.body, authResult.status);
  }

  const serviceId =
    url.searchParams.get("serviceId")?.trim() ?? url.searchParams.get("containerId")?.trim() ?? "";
  if (!serviceId) {
    return jsonResponse({ ok: false, error: "Missing serviceId", code: "INVALID_REQUEST" }, 400);
  }

  const shell = url.searchParams.get("shell") === "sh" ? "sh" : "bash";
  const runtimeResult = await resolveWebSocketRuntime(serviceId);
  if (!runtimeResult.ok) {
    return runtimeResult.response;
  }

  const upgraded = server.upgrade(req, {
    data: {
      kind: "terminal",
      runtime: runtimeResult.runtime,
      shell,
      actor: authResult.actor
    } satisfies TerminalSocketData
  });

  return upgraded ? undefined : jsonResponse({ ok: false, error: "Upgrade failed" }, 500);
}

export const serviceObservabilityWebSocket = {
  async open(ws: ServerWebSocket<ObservabilitySocketData>) {
    if (ws.data.kind === "logs") {
      try {
        ws.data.handle = await startServiceLogStream({
          runtime: ws.data.runtime,
          tail: ws.data.tail,
          onLine: (line) => ws.send(JSON.stringify(line))
        });
      } catch (error) {
        ws.send(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            message: error instanceof Error ? error.message : String(error),
            stream: "stderr"
          })
        );
        ws.close(1011, "log stream failed");
      }
      return;
    }

    try {
      await recordTerminalAudit({
        actor: ws.data.actor,
        runtime: ws.data.runtime,
        shell: ws.data.shell,
        action: "service.terminal.open",
        outcome: "success",
        summary: `Opened ${ws.data.shell} session for ${ws.data.runtime.service.name}.`
      });
      ws.data.handle = await startServiceTerminal({
        runtime: ws.data.runtime,
        shell: ws.data.shell,
        onData: (chunk) => ws.send(chunk),
        onExit: (code) => {
          ws.send(`\r\n[terminal exited with code ${code ?? 0}]\r\n`);
          ws.close(1000, "terminal exited");
        }
      });
    } catch (error) {
      await recordTerminalAudit({
        actor: ws.data.actor,
        runtime: ws.data.runtime,
        shell: ws.data.shell,
        action: "service.terminal.open",
        outcome: "failed",
        summary:
          error instanceof Error
            ? error.message
            : `Failed to open terminal for ${ws.data.runtime.service.name}.`
      });
      ws.send(
        `\r\nTerminal unavailable: ${error instanceof Error ? error.message : String(error)}\r\n`
      );
      ws.close(1011, "terminal unavailable");
    }
  },
  message(ws: ServerWebSocket<ObservabilitySocketData>, message: string | Buffer) {
    if (ws.data.kind !== "terminal" || !ws.data.handle) {
      return;
    }

    ws.data.handle.write(typeof message === "string" ? message : message.toString("utf8"));
  },
  close(ws: ServerWebSocket<ObservabilitySocketData>) {
    ws.data.handle?.close();

    if (ws.data.kind === "terminal") {
      void recordTerminalAudit({
        actor: ws.data.actor,
        runtime: ws.data.runtime,
        shell: ws.data.shell,
        action: "service.terminal.close",
        outcome: "success",
        summary: `Closed ${ws.data.shell} session for ${ws.data.runtime.service.name}.`
      });
    }
  },
  error(ws: ServerWebSocket<ObservabilitySocketData>) {
    ws.data.handle?.close();
  }
};
