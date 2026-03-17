import { Command } from "commander";
import { loadConfig, getCurrentContext } from "../config";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";

export function doctorCommand(): Command {
  const cmd = new Command("doctor")
    .description("Verify DaoFlow setup and connectivity")
    .action(async () => {
      console.log("\n🩺 DaoFlow Doctor\n");

      const checks: { name: string; status: "ok" | "warn" | "fail"; detail: string }[] = [];

      // 1. Config check
      const config = loadConfig();
      const ctx = getCurrentContext();

      checks.push({
        name: "Configuration",
        status: ctx ? "ok" : "warn",
        detail: ctx ? `API URL: ${ctx.apiUrl}` : "No context configured. Run: daoflow login <url>"
      });

      // 2. API connectivity — use raw tRPC client (health is public, no auth needed)
      if (ctx) {
        try {
          const trpc = createTRPCClient<AppRouter>({
            links: [
              httpLink({
                url: `${ctx.apiUrl.replace(/\/$/, "")}/trpc`,
                headers() {
                  return {
                    Cookie: `better-auth.session_token=${ctx.token}`,
                  };
                },
              }),
            ],
          });
          const health = await trpc.health.query();
          checks.push({
            name: "API connectivity",
            status: health.status === "healthy" ? "ok" : "fail",
            detail: `Status: ${health.status} | Service: ${health.service}`
          });
        } catch (apiErr) {
          checks.push({
            name: "API connectivity",
            status: "fail",
            detail: `Could not connect: ${apiErr instanceof Error ? apiErr.message : String(apiErr)}`
          });
        }
      }

      // 3. Auth token
      checks.push({
        name: "Authentication",
        status: ctx?.token ? "ok" : "warn",
        detail: ctx?.token ? "Token configured" : "No token found. Run: daoflow login"
      });

      // 4. Context name
      checks.push({
        name: "Active context",
        status: "ok",
        detail: config.currentContext
      });

      // Print results
      const icons = { ok: "✅", warn: "⚠️ ", fail: "❌" };
      for (const check of checks) {
        console.log(`  ${icons[check.status]}  ${check.name}: ${check.detail}`);
      }

      const failures = checks.filter((c) => c.status === "fail");
      console.log("");
      if (failures.length > 0) {
        console.log(`Found ${failures.length} issue(s). Resolve them and re-run daoflow doctor.`);
        process.exit(1);
      } else {
        console.log("All checks passed! DaoFlow is ready.");
      }
    });

  return cmd;
}
