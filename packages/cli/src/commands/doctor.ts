import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";
import { Command } from "commander";
import { getCurrentContext, loadConfig } from "../config";
import { resolveCommandJsonOption } from "../command-helpers";

interface DoctorCheck {
  name: string;
  status: "ok" | "warn" | "fail";
  detail: string;
}

export function doctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Verify DaoFlow setup and connectivity")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const checks: DoctorCheck[] = [];

      if (!isJson) {
        console.log("\n🩺 DaoFlow Doctor\n");
      }

      const config = loadConfig();
      const ctx = getCurrentContext();

      checks.push({
        name: "Configuration",
        status: ctx ? "ok" : "warn",
        detail: ctx ? `API URL: ${ctx.apiUrl}` : "No context configured. Run: daoflow login <url>"
      });

      if (ctx) {
        try {
          const trpc = createTRPCClient<AppRouter>({
            links: [
              httpLink({
                url: `${ctx.apiUrl.replace(/\/$/, "")}/trpc`,
                headers() {
                  return {
                    Cookie: `better-auth.session_token=${ctx.token}`
                  };
                }
              })
            ]
          });
          const health = await trpc.health.query();
          checks.push({
            name: "API connectivity",
            status: health.status === "healthy" ? "ok" : "fail",
            detail: `Status: ${health.status} | Service: ${health.service}`
          });
        } catch (error) {
          checks.push({
            name: "API connectivity",
            status: "fail",
            detail: `Could not connect: ${error instanceof Error ? error.message : String(error)}`
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
        detail: config.currentContext
      });

      const failures = checks.filter((check) => check.status === "fail");
      const warnings = checks.filter((check) => check.status === "warn");
      const summary = {
        total: checks.length,
        ok: checks.filter((check) => check.status === "ok").length,
        warnings: warnings.length,
        failures: failures.length
      };

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

  return cmd;
}
