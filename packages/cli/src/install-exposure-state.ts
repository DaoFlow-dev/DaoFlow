import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { isRecord, readString } from "./command-helpers";

export const DASHBOARD_EXPOSURE_MODES = [
  "none",
  "traefik",
  "cloudflare-quick",
  "tailscale-serve",
  "tailscale-funnel"
] as const;

export type DashboardExposureMode = (typeof DASHBOARD_EXPOSURE_MODES)[number];
export type DashboardExposureAccess = "local" | "tailnet" | "public";

export interface DashboardExposureState {
  mode: DashboardExposureMode;
  access: DashboardExposureAccess;
  url?: string;
  pid?: number;
  detail?: string;
  updatedAt: string;
}

export interface DashboardExposureResult {
  ok: boolean;
  mode: DashboardExposureMode;
  access: DashboardExposureAccess;
  url?: string;
  detail?: string;
  statePath?: string;
  logPath?: string;
}

const EXPOSURE_STATE_DIR = ".daoflow";
const EXPOSURE_STATE_FILE = "dashboard-exposure.json";

export function getExposureStateDir(installDir: string): string {
  return join(installDir, EXPOSURE_STATE_DIR);
}

export function getDashboardExposureStatePath(installDir: string): string {
  return join(getExposureStateDir(installDir), EXPOSURE_STATE_FILE);
}

export function parseDashboardExposureMode(
  value: string | undefined | null
): DashboardExposureMode | null {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) {
    return "none";
  }

  const aliased = (
    {
      cloudflare: "cloudflare-quick",
      tailscale: "tailscale-serve"
    } as const
  )[normalized as "cloudflare" | "tailscale"];

  const resolved = aliased ?? normalized;
  return DASHBOARD_EXPOSURE_MODES.find((mode) => mode === resolved) ?? null;
}

export function describeDashboardExposureMode(mode: DashboardExposureMode): string {
  switch (mode) {
    case "traefik":
      return "Built-in Traefik (public HTTPS + automatic Let's Encrypt)";
    case "cloudflare-quick":
      return "Cloudflare Quick Tunnel (public, ephemeral)";
    case "tailscale-serve":
      return "Tailscale Serve (tailnet-only HTTPS)";
    case "tailscale-funnel":
      return "Tailscale Funnel (public HTTPS)";
    default:
      return "Local only";
  }
}

export function readDashboardExposureState(installDir: string): DashboardExposureState | null {
  const statePath = getDashboardExposureStatePath(installDir);
  if (!existsSync(statePath)) {
    return null;
  }

  try {
    const parsed = JSON.parse(readFileSync(statePath, "utf8")) as unknown;
    if (!isRecord(parsed)) {
      return null;
    }

    const mode = parseDashboardExposureMode(readString(parsed.mode));
    const access = readString(parsed.access);
    if (!mode || !access || !["local", "tailnet", "public"].includes(access)) {
      return null;
    }

    return {
      mode,
      access: access as DashboardExposureAccess,
      url: readString(parsed.url),
      pid: typeof parsed.pid === "number" ? parsed.pid : undefined,
      detail: readString(parsed.detail),
      updatedAt: readString(parsed.updatedAt) ?? new Date(0).toISOString()
    };
  } catch {
    return null;
  }
}

export function writeDashboardExposureState(
  installDir: string,
  state: DashboardExposureState
): DashboardExposureResult {
  const stateDir = getExposureStateDir(installDir);
  const statePath = getDashboardExposureStatePath(installDir);
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  return {
    ok: true,
    mode: state.mode,
    access: state.access,
    url: state.url,
    detail: state.detail,
    statePath
  };
}

export function clearDashboardExposureState(installDir: string): void {
  const statePath = getDashboardExposureStatePath(installDir);
  if (!existsSync(statePath)) {
    return;
  }

  rmSync(statePath, { force: true });
}
