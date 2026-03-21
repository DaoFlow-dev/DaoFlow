import { Command } from "commander";
import type { RouterOutputs } from "../trpc-client";
import { getCurrentContext, loadConfig } from "../config";
import {
  getErrorMessage,
  resolveCommandJsonOption,
  withResolvedCommandRequestOptions
} from "../command-helpers";
import { createClient } from "../trpc-client";

type DoctorContext = NonNullable<ReturnType<typeof getCurrentContext>>;
type DoctorClient = Pick<ReturnType<typeof createClient>, "health" | "serverReadiness">;
type DoctorClientFactory = (ctx: DoctorContext) => DoctorClient;

export interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export interface DoctorSummary {
  total: number;
  ok: number;
  warnings: number;
  failures: number;
}

export interface DoctorRunResult {
  checks: DoctorCheck[];
  summary: DoctorSummary;
}

function resolveDoctorCheckStatus(readinessStatus: string): DoctorCheck["status"] {
  if (readinessStatus === "ready") {
    return "ok";
  }

  if (readinessStatus === "attention") {
    return "warn";
  }

  return "fail";
}

function buildServerDoctorChecks(serverReadiness: RouterOutputs["serverReadiness"]): DoctorCheck[] {
  const checks: DoctorCheck[] = [
    {
      name: "Server readiness poller",
      status: "ok",
      detail: `Interval ${Math.round(serverReadiness.summary.pollIntervalMs / 1000)}s | Ready ${serverReadiness.summary.readyServers}/${serverReadiness.summary.totalServers}`
    }
  ];

  for (const server of serverReadiness.checks) {
    const issues = server.issues.length > 0 ? ` | Issues: ${server.issues.join("; ")}` : "";
    checks.push({
      name: `Server ${server.serverName}`,
      status: resolveDoctorCheckStatus(server.readinessStatus),
      detail:
        `${server.serverHost} | SSH ${server.sshReachable ? "ok" : "blocked"} | Docker ${server.dockerVersion ?? "unavailable"} | Compose ${server.composeVersion ?? "unavailable"} | Checked ${server.checkedAt}` +
        (server.latencyMs === null ? "" : ` | Latency ${server.latencyMs}ms`) +
        issues
    });
  }

  return checks;
}

function summarizeDoctorChecks(checks: DoctorCheck[]): DoctorSummary {
  const failures = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");

  return {
    total: checks.length,
    ok: checks.filter((check) => check.status === "ok").length,
    warnings: warnings.length,
    failures: failures.length
  };
}

export async function collectDoctorChecks({
  ctx,
  currentContext,
  createClientImpl = createClient as DoctorClientFactory
}: {
  ctx: ReturnType<typeof getCurrentContext>;
  currentContext: string;
  createClientImpl?: DoctorClientFactory;
}): Promise<DoctorRunResult> {
  const checks: DoctorCheck[] = [
    {
      name: "Configuration",
      status: ctx ? "ok" : "warn",
      detail: ctx ? `API URL: ${ctx.apiUrl}` : "No context configured. Run: daoflow login <url>"
    }
  ];

  if (ctx) {
    try {
      const trpc = createClientImpl(ctx);
      const [healthResult, serverReadinessResult] = await Promise.allSettled([
        trpc.health.query(),
        trpc.serverReadiness.query({})
      ]);

      if (healthResult.status === "fulfilled") {
        checks.push({
          name: "API connectivity",
          status: healthResult.value.status === "healthy" ? "ok" : "fail",
          detail: `Status: ${healthResult.value.status} | Service: ${healthResult.value.service}`
        });
      } else {
        checks.push({
          name: "API connectivity",
          status: "fail",
          detail: `Could not connect: ${getErrorMessage(healthResult.reason)}`
        });
      }

      if (serverReadinessResult.status === "fulfilled") {
        checks.push(...buildServerDoctorChecks(serverReadinessResult.value));
      } else {
        checks.push({
          name: "Server readiness diagnostics",
          status: "fail",
          detail: `Could not load persisted readiness data: ${getErrorMessage(serverReadinessResult.reason)}`
        });
      }
    } catch (error) {
      checks.push({
        name: "API connectivity",
        status: "fail",
        detail: `Could not connect: ${getErrorMessage(error)}`
      });
    }
  }

  checks.push({
    name: "Authentication",
    status: ctx?.token ? "ok" : "warn",
    detail: ctx?.token ? "Token configured" : "No token found. Run: daoflow login"
  });

  checks.push({
    name: "Active context",
    status: "ok",
    detail: currentContext
  });

  return { checks, summary: summarizeDoctorChecks(checks) };
}

export function doctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Verify DaoFlow setup and connectivity")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      if (!isJson) {
        console.log("\n🩺 DaoFlow Doctor\n");
      }

      await withResolvedCommandRequestOptions(command, async () => {
        const config = loadConfig();
        const ctx = getCurrentContext();
        const { checks, summary } = await collectDoctorChecks({
          ctx,
          currentContext: config.currentContext
        });
        const failures = checks.filter((check) => check.status === "fail");

        if (isJson) {
          if (failures.length > 0) {
            console.log(
              JSON.stringify({
                ok: false,
                error: `Found ${failures.length} issue(s)`,
                code: "DOCTOR_FAILED",
                data: { checks, summary }
              })
            );
            process.exit(1);
          }

          console.log(JSON.stringify({ ok: true, data: { checks, summary } }));
          return;
        }

        const icons = { ok: "✅", warn: "⚠️ ", fail: "❌" };
        for (const check of checks) {
          console.log(`  ${icons[check.status]}  ${check.name}: ${check.detail}`);
        }

        console.log("");
        if (failures.length > 0) {
          console.log(`Found ${failures.length} issue(s). Resolve them and re-run daoflow doctor.`);
          process.exit(1);
        }

        console.log("All checks passed! DaoFlow is ready.");
      });
    });

  return cmd;
}
