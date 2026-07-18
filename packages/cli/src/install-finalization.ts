import ora from "ora";
import { CommandActionError, type CommandActionContext } from "./command-action";
import { getExecErrorMessage } from "./command-helpers";
import { buildCloudflareTunnelGuide, getCloudflareTunnelDashboardUrl } from "./install-cloudflare";
import type { InstallConfiguration } from "./install-config-types";
import { configureDashboardExposure } from "./install-exposure";
import { describeDashboardExposureMode } from "./install-exposure-state";
import {
  buildInstallUrl,
  runComposeCommand,
  writeInstallFile,
  type InstallerRuntime
} from "./installer-lifecycle";
import { waitForInstallHealth } from "./install-health";
import { getInstallWorkflowReadiness } from "./install-workflow-runtime";

export async function verifyInstallStartup(input: {
  runtime: InstallerRuntime;
  config: InstallConfiguration;
  envPath: string;
  ctx: CommandActionContext;
}): Promise<boolean> {
  const healthSpinner = !input.ctx.isJson
    ? ora("Waiting for DaoFlow startup readiness...").start()
    : null;
  const readiness = getInstallWorkflowReadiness({
    workflowProfile: input.config.workflowProfile,
    phase: "startup"
  });
  const healthy = await waitForInstallHealth({
    runtime: input.runtime,
    port: input.config.port,
    requiredWorkerDetail: readiness.requiredWorkerDetail
  });

  if (healthy) {
    healthSpinner?.succeed("DaoFlow is ready!");
    return true;
  }

  healthSpinner?.fail("Readiness check timed out");
  let containerStatus = "";
  try {
    containerStatus = String(
      runComposeCommand({
        runtime: input.runtime,
        dir: input.config.dir,
        args: 'ps daoflow --format "{{.Status}}"',
        envPath: input.envPath
      })
    ).trim();
  } catch {
    // Best-effort diagnostic only.
  }

  const lines = [
    readiness.timeoutMessage,
    `Run 'docker compose logs daoflow' in ${input.config.dir} to diagnose.`
  ];
  if (containerStatus.toLowerCase().includes("restarting")) {
    lines.push(
      "The container is crash-looping — check the logs above for database auth errors or missing AVX CPU support."
    );
  }

  input.ctx.fail(lines.join(" "), {
    code: readiness.timeoutCode,
    extra: {
      directory: input.config.dir,
      port: input.config.port,
      containerStatus: containerStatus || undefined
    }
  });
}

export async function finalizeInstallExposure(input: {
  runtime: InstallerRuntime;
  config: InstallConfiguration;
  envPath: string;
  envContent: string;
  healthy: boolean;
  ctx: CommandActionContext;
}): Promise<{
  displayUrl: string;
  healthy: boolean;
  exposure: Awaited<ReturnType<typeof configureDashboardExposure>>;
  cloudflareTunnel?: { publicUrl: string; guide: string[] };
}> {
  const exposureSpinner =
    input.config.exposureMode !== "none" && !input.ctx.isJson
      ? ora("Configuring dashboard exposure...").start()
      : null;
  let exposure = await configureDashboardExposure({
    runtime: input.runtime,
    installDir: input.config.dir,
    mode: input.config.exposureMode,
    port: input.config.port,
    domain: input.config.domain
  });

  const cloudflareTunnel = input.config.cloudflareTunnelEnabled
    ? {
        publicUrl: getCloudflareTunnelDashboardUrl(input.config.domain),
        guide: buildCloudflareTunnelGuide({ domain: input.config.domain })
      }
    : undefined;
  const displayUrl =
    cloudflareTunnel?.publicUrl ??
    exposure.url ??
    buildInstallUrl({
      domain: input.config.domain,
      scheme: input.config.scheme,
      port: input.config.port
    });

  let envContent = input.envContent;
  let healthy = input.healthy;
  const currentPublicUrl = envContent.match(/^BETTER_AUTH_URL=(.+)$/m)?.[1]?.trim();
  if (exposure.url && exposure.url !== currentPublicUrl) {
    envContent = envContent.replace(/^BETTER_AUTH_URL=.*/m, `BETTER_AUTH_URL=${exposure.url}`);
    writeInstallFile(input.envPath, envContent);
    const authUrlSpinner = !input.ctx.isJson
      ? ora(
          `Applying exposed auth URL (${describeDashboardExposureMode(input.config.exposureMode)})...`
        ).start()
      : null;
    const readiness = getInstallWorkflowReadiness({
      workflowProfile: input.config.workflowProfile,
      phase: "public-url-update"
    });
    try {
      runComposeCommand({
        runtime: input.runtime,
        dir: input.config.dir,
        args: "up -d",
        envPath: input.envPath
      });
      authUrlSpinner?.succeed("BETTER_AUTH_URL updated to the exposed HTTPS URL");
      healthy = await waitForInstallHealth({
        runtime: input.runtime,
        port: input.config.port,
        attempts: 10,
        requiredWorkerDetail: readiness.requiredWorkerDetail
      });
      if (!healthy) {
        authUrlSpinner?.fail("DaoFlow did not become ready after applying BETTER_AUTH_URL");
        input.ctx.fail(readiness.timeoutMessage, {
          code: readiness.timeoutCode,
          extra: { directory: input.config.dir, port: input.config.port }
        });
      }
    } catch (error) {
      if (error instanceof CommandActionError) throw error;

      authUrlSpinner?.fail("Failed to apply the exposed auth URL");
      exposure = {
        ...exposure,
        ok: false,
        detail: `Exposure was created, but restarting DaoFlow with the new BETTER_AUTH_URL failed: ${getExecErrorMessage(error)}`
      };
    }
  }

  if (exposureSpinner) {
    if (exposure.ok) {
      exposureSpinner.succeed(
        exposure.url
          ? `Exposure ready: ${exposure.url}`
          : `Exposure configured: ${describeDashboardExposureMode(input.config.exposureMode)}`
      );
    } else {
      exposureSpinner.warn(
        exposure.detail ??
          `Could not configure ${describeDashboardExposureMode(input.config.exposureMode)}.`
      );
    }
  }

  return { displayUrl, healthy, exposure, cloudflareTunnel };
}
