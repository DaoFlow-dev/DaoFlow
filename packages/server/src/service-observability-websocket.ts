import type { Server, ServerWebSocket } from "bun";
import {
  appendOperationLog,
  closeHostTerminalOperation,
  createHostTerminalOperation,
  type ServerOperationActor
} from "./db/services/server-operations";
import { resolveServiceRuntime, type ResolvedServiceRuntime } from "./db/services/service-runtime";
import { resolveTeamIdForUser } from "./db/services/teams";
import { authorizeRequest, type AuthorizedRequestActor } from "./routes/request-auth";
import { recordServiceTerminalAudit } from "./service-terminal-audit";
import { resolveExecutionTarget, type ExecutionTarget } from "./worker/execution-target";
import {
  startServiceLogStream,
  startServiceTerminal,
  type ServiceStreamHandle,
  type ServiceTerminalHandle
} from "./worker/service-observability";
import { startHostTerminal, type HostTerminalHandle } from "./worker/server-host-terminal";

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

type HostTerminalSocketData = {
  kind: "host-terminal";
  operationId: string;
  serverId: string;
  serverName: string;
  target: ExecutionTarget;
  shell: "bash" | "sh";
  actor: AuthorizedRequestActor;
  handle?: HostTerminalHandle;
};

type ObservabilitySocketData = LogsSocketData | TerminalSocketData | HostTerminalSocketData;

function jsonResponse(body: Record<string, unknown>, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" }
  });
}

function serverOperationActor(actor: AuthorizedRequestActor): ServerOperationActor {
  return {
    requestedByUserId: actor.auth.principal.linkedUserId ?? actor.session.user.id,
    requestedByEmail: actor.session.user.email,
    requestedByRole: actor.role
  };
}

async function resolveWebSocketRuntime(
  serviceId: string,
  actor: AuthorizedRequestActor,
  permissionScope: "logs:read" | "terminal:open"
): Promise<{ ok: true; runtime: ResolvedServiceRuntime } | { ok: false; response: Response }> {
  const teamId = await resolveTeamIdForUser(actor.session.user.id);
  if (!teamId) {
    return {
      ok: false,
      response: jsonResponse(
        { ok: false, error: "No organization is available for this user.", code: "NO_TEAM" },
        412
      )
    };
  }

  const runtimeResult = await resolveServiceRuntime(serviceId, {
    teamId,
    actor: {
      id: actor.session.user.id,
      email: actor.session.user.email,
      role: actor.role,
      actorType: actor.auth.method === "api-token" ? "token" : "user"
    },
    action: permissionScope === "logs:read" ? "service.logs.denied" : "service.terminal.denied",
    permissionScope
  });
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
  if (
    url.pathname !== "/ws/container-logs" &&
    url.pathname !== "/ws/docker-terminal" &&
    url.pathname !== "/ws/host-terminal"
  ) {
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

    const runtimeResult = await resolveWebSocketRuntime(serviceId, authResult.actor, "logs:read");
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

  if (url.pathname === "/ws/host-terminal") {
    const serverId = url.searchParams.get("serverId")?.trim() ?? "";
    if (!serverId) {
      return jsonResponse({ ok: false, error: "Missing serverId", code: "INVALID_REQUEST" }, 400);
    }

    const shell = url.searchParams.get("shell") === "sh" ? "sh" : "bash";
    const teamId = await resolveTeamIdForUser(authResult.actor.session.user.id);
    if (!teamId) {
      return jsonResponse(
        { ok: false, error: "No organization is available for this user.", code: "NO_TEAM" },
        412
      );
    }
    const operationResult = await createHostTerminalOperation({
      serverId,
      teamId,
      shell,
      actor: serverOperationActor(authResult.actor)
    });
    if (operationResult.status !== "ok") {
      return jsonResponse({ ok: false, error: "Server not found", code: "NOT_FOUND" }, 404);
    }

    const target = await resolveExecutionTarget(
      operationResult.server,
      operationResult.operation.id,
      teamId
    );

    const upgraded = server.upgrade(req, {
      data: {
        kind: "host-terminal",
        operationId: operationResult.operation.id,
        serverId,
        serverName: operationResult.server.name,
        target,
        shell,
        actor: authResult.actor
      } satisfies HostTerminalSocketData
    });

    return upgraded ? undefined : jsonResponse({ ok: false, error: "Upgrade failed" }, 500);
  }

  const serviceId =
    url.searchParams.get("serviceId")?.trim() ?? url.searchParams.get("containerId")?.trim() ?? "";
  if (!serviceId) {
    return jsonResponse({ ok: false, error: "Missing serviceId", code: "INVALID_REQUEST" }, 400);
  }

  const shell = url.searchParams.get("shell") === "sh" ? "sh" : "bash";
  const runtimeResult = await resolveWebSocketRuntime(serviceId, authResult.actor, "terminal:open");
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

    if (ws.data.kind === "host-terminal") {
      try {
        ws.data.handle = startHostTerminal({
          target: ws.data.target,
          shell: ws.data.shell,
          onData: (chunk) => ws.send(chunk),
          onExit: (code) => {
            ws.send(`\r\n[host terminal exited with code ${code ?? 0}]\r\n`);
            ws.close(1000, "host terminal exited");
          }
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await appendOperationLog(ws.data.operationId, "error", message);
        ws.send(`\r\nHost terminal unavailable: ${message}\r\n`);
        ws.close(1011, "host terminal unavailable");
      }
      return;
    }

    try {
      await recordServiceTerminalAudit({
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
      await recordServiceTerminalAudit({
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
    if ((ws.data.kind !== "terminal" && ws.data.kind !== "host-terminal") || !ws.data.handle) {
      return;
    }

    ws.data.handle.write(typeof message === "string" ? message : message.toString("utf8"));
  },
  close(ws: ServerWebSocket<ObservabilitySocketData>) {
    ws.data.handle?.close();

    if (ws.data.kind === "terminal") {
      void recordServiceTerminalAudit({
        actor: ws.data.actor,
        runtime: ws.data.runtime,
        shell: ws.data.shell,
        action: "service.terminal.close",
        outcome: "success",
        summary: `Closed ${ws.data.shell} session for ${ws.data.runtime.service.name}.`
      });
    } else if (ws.data.kind === "host-terminal") {
      void closeHostTerminalOperation({
        operationId: ws.data.operationId,
        actor: serverOperationActor(ws.data.actor)
      });
    }
  },
  error(ws: ServerWebSocket<ObservabilitySocketData>) {
    ws.data.handle?.close();
  }
};
