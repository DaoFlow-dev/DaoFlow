import { spawn } from "node:child_process";
import { closeSync, mkdirSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getErrorMessage, isRecord, readString } from "./command-helpers";
import {
  clearDashboardExposureState,
  getDashboardExposureStatePath,
  getExposureStateDir,
  readDashboardExposureState,
  writeDashboardExposureState,
  type DashboardExposureResult,
  type DashboardExposureMode
} from "./install-exposure-state";
import { getTraefikDashboardUrl, isTraefikExposureMode } from "./install-traefik";
import type { InstallerRuntime } from "./installer-lifecycle";
const CLOUDFLARE_LOG_FILE = "cloudflare-quick.log";
const URL_PATTERN = /(https:\/\/[^\s|]+)/i;
const CLOUDFLARE_URL_PATTERN = /(https:\/\/[a-z0-9.-]+\.trycloudflare\.com)/i;

function getCloudflareLogPath(installDir: string): string {
  return join(getExposureStateDir(installDir), CLOUDFLARE_LOG_FILE);
}

function readOptionalFile(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    return "";
  }
}

function assertCommandInstalled(runtime: InstallerRuntime, command: string): void {
  try {
    runtime.exec(`command -v ${command}`, { encoding: "utf-8", stdio: "pipe" });
  } catch {
    throw new Error(
      `${command} is not installed or not in PATH. Install ${command} on this host and re-run 'daoflow install --expose ...'.`
    );
  }
}

function runTextCommand(runtime: InstallerRuntime, command: string): string {
  return String(runtime.exec(command, { encoding: "utf-8", stdio: "pipe" })).trim();
}

function stopPreviousCloudflareQuickTunnel(installDir: string): void {
  const existing = readDashboardExposureState(installDir);
  if (existing?.mode !== "cloudflare-quick" || typeof existing.pid !== "number") {
    return;
  }

  try {
    process.kill(existing.pid, "SIGTERM");
  } catch {
    // Best-effort cleanup for a stale pid.
  }
}

async function configureCloudflareQuickTunnel(input: {
  runtime: InstallerRuntime;
  installDir: string;
  port: number;
}): Promise<DashboardExposureResult> {
  assertCommandInstalled(input.runtime, "cloudflared");
  stopPreviousCloudflareQuickTunnel(input.installDir);

  const stateDir = getExposureStateDir(input.installDir);
  const statePath = getDashboardExposureStatePath(input.installDir);
  const logPath = getCloudflareLogPath(input.installDir);
  mkdirSync(stateDir, { recursive: true });

  const logFd = openSync(logPath, "a");
  try {
    const child = spawn(
      "cloudflared",
      ["tunnel", "--url", `http://127.0.0.1:${input.port}`, "--no-autoupdate"],
      {
        detached: true,
        stdio: ["ignore", logFd, logFd]
      }
    );
    child.unref();

    let url: string | undefined;
    for (let attempt = 0; attempt < 30; attempt++) {
      await input.runtime.sleep(500);
      const match = readOptionalFile(logPath).match(CLOUDFLARE_URL_PATTERN);
      url = match?.[1];
      if (url) {
        break;
      }
    }

    const detail = url
      ? "Cloudflare Quick Tunnel is forwarding the dashboard to a public trycloudflare.com URL."
      : "Started cloudflared, but the public tunnel URL was not detected yet. Check the tunnel log for status.";

    const result = writeDashboardExposureState(input.installDir, {
      mode: "cloudflare-quick",
      access: "public",
      pid: child.pid ?? undefined,
      url,
      detail,
      updatedAt: new Date().toISOString()
    });

    return {
      ...result,
      ok: Boolean(url),
      detail,
      logPath,
      statePath
    };
  } finally {
    closeSync(logFd);
  }
}

function parseCommandUrl(output: string): string | undefined {
  return output.match(URL_PATTERN)?.[1];
}

function resolveTailscaleUrl(runtime: InstallerRuntime): string | undefined {
  try {
    const raw = runTextCommand(runtime, "tailscale status --json");
    const parsed = JSON.parse(raw) as unknown;
    if (!isRecord(parsed) || !isRecord(parsed.Self)) {
      return undefined;
    }

    const dnsName = readString(parsed.Self.DNSName);
    if (!dnsName) {
      return undefined;
    }

    return `https://${dnsName.replace(/\.$/, "")}`;
  } catch {
    return undefined;
  }
}

function configureTailscaleExposure(input: {
  runtime: InstallerRuntime;
  installDir: string;
  port: number;
  mode: "tailscale-serve" | "tailscale-funnel";
}): DashboardExposureResult {
  assertCommandInstalled(input.runtime, "tailscale");

  const command =
    input.mode === "tailscale-funnel"
      ? `tailscale funnel --bg ${input.port}`
      : `tailscale serve --bg ${input.port}`;

  const output = runTextCommand(input.runtime, command);
  const url = parseCommandUrl(output) ?? resolveTailscaleUrl(input.runtime);
  const access = input.mode === "tailscale-funnel" ? "public" : "tailnet";
  const detail =
    input.mode === "tailscale-funnel"
      ? "Tailscale Funnel is forwarding the dashboard to the public internet over HTTPS."
      : "Tailscale Serve is forwarding the dashboard over HTTPS inside your tailnet.";

  const result = writeDashboardExposureState(input.installDir, {
    mode: input.mode,
    access,
    url,
    detail,
    updatedAt: new Date().toISOString()
  });

  return {
    ...result,
    detail
  };
}

export async function configureDashboardExposure(input: {
  runtime: InstallerRuntime;
  installDir: string;
  mode: DashboardExposureMode;
  port: number;
  domain: string;
}): Promise<DashboardExposureResult> {
  if (input.mode !== "cloudflare-quick") {
    stopPreviousCloudflareQuickTunnel(input.installDir);
  }

  if (input.mode === "none") {
    clearDashboardExposureState(input.installDir);
    return {
      ok: true,
      mode: "none",
      access: "local",
      detail: "Dashboard is only exposed on the local host port."
    };
  }

  try {
    if (isTraefikExposureMode(input.mode)) {
      const url = getTraefikDashboardUrl(input.domain);
      return writeDashboardExposureState(input.installDir, {
        mode: "traefik",
        access: "public",
        url,
        detail:
          "Traefik will publish the dashboard on ports 80 and 443 and manage Let's Encrypt certificates automatically.",
        updatedAt: new Date().toISOString()
      });
    }

    if (input.mode === "cloudflare-quick") {
      return await configureCloudflareQuickTunnel(input);
    }

    return configureTailscaleExposure({
      ...input,
      mode: input.mode
    });
  } catch (error) {
    return {
      ok: false,
      mode: input.mode,
      access: input.mode === "tailscale-serve" ? "tailnet" : "public",
      detail: getErrorMessage(error)
    };
  }
}
