type DockerPsRecord = Record<string, unknown>;
type DockerStatsRecord = Record<string, unknown>;
type DockerStateRecord = Record<string, unknown>;

export interface ServiceContainerRef {
  id: string;
  name: string;
  state: string;
  status: string;
}

export interface ServiceContainerStats {
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  networkRxMB: number;
  networkTxMB: number;
  blockReadMB: number;
  blockWriteMB: number;
  pids: number;
}

export interface ServiceContainerState {
  startedAt: string | null;
  restartCount: number;
  running: boolean;
}

function readString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function readNumber(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  return typeof value === "number" ? value : 0;
}

export function parseDockerJsonLines<T extends Record<string, unknown>>(lines: string[]): T[] {
  return lines
    .map((line) => line.trim())
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const parsed = JSON.parse(line) as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? [parsed as T] : [];
      } catch {
        return [];
      }
    });
}

export function parseDockerPsLines(lines: string[]): ServiceContainerRef[] {
  return parseDockerJsonLines<DockerPsRecord>(lines).map((record) => ({
    id: readString(record, "ID"),
    name: readString(record, "Names") || readString(record, "Name"),
    state: readString(record, "State"),
    status: readString(record, "Status")
  }));
}

function parsePercent(raw: string): number {
  const normalized = raw.trim().replace("%", "");
  const value = Number.parseFloat(normalized);
  return Number.isFinite(value) ? value : 0;
}

function parseSizeComponent(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "--" || trimmed === "0B") {
    return 0;
  }

  const match = trimmed.match(/^([0-9]+(?:\.[0-9]+)?)\s*([kmgtpe]?i?b)$/i);
  if (!match) {
    return 0;
  }

  const value = Number.parseFloat(match[1] ?? "0");
  if (!Number.isFinite(value)) {
    return 0;
  }

  const unit = (match[2] ?? "b").toLowerCase();
  const multiplierByUnit: Record<string, number> = {
    b: 1 / (1000 * 1000),
    kb: 1 / 1000,
    kib: 1 / 1024,
    mb: 1,
    mib: 1,
    gb: 1000,
    gib: 1024,
    tb: 1000 * 1000,
    tib: 1024 * 1024,
    pb: 1000 * 1000 * 1000,
    pib: 1024 * 1024 * 1024
  };

  return value * (multiplierByUnit[unit] ?? 0);
}

function parseSizePair(raw: string): [number, number] {
  const [left = "", right = ""] = raw.split("/").map((entry) => entry.trim());
  return [parseSizeComponent(left), parseSizeComponent(right)];
}

export function parseDockerStatsLines(lines: string[]): ServiceContainerStats[] {
  return parseDockerJsonLines<DockerStatsRecord>(lines).map((record) => {
    const [memoryUsageMB, memoryLimitMB] = parseSizePair(readString(record, "MemUsage"));
    const [networkRxMB, networkTxMB] = parseSizePair(readString(record, "NetIO"));
    const [blockReadMB, blockWriteMB] = parseSizePair(readString(record, "BlockIO"));

    return {
      cpuPercent: parsePercent(readString(record, "CPUPerc")),
      memoryUsageMB,
      memoryLimitMB,
      networkRxMB,
      networkTxMB,
      blockReadMB,
      blockWriteMB,
      pids: readNumber(record, "PIDs") || Number.parseInt(readString(record, "PIDs"), 10) || 0
    };
  });
}

export function parseDockerStateLines(lines: string[]): ServiceContainerState[] {
  return parseDockerJsonLines<DockerStateRecord>(lines).map((record) => ({
    startedAt: readString(record, "StartedAt") || null,
    restartCount: readNumber(record, "RestartCount"),
    running: Boolean(record.Running)
  }));
}

export function formatUptime(startedAtValues: Array<string | null>): string {
  const timestamps = startedAtValues
    .map((value) => (value ? Date.parse(value) : Number.NaN))
    .filter((value) => Number.isFinite(value));

  if (timestamps.length === 0) {
    return "—";
  }

  const earliestStart = Math.min(...timestamps);
  const elapsedMs = Math.max(0, Date.now() - earliestStart);
  const totalSeconds = Math.floor(elapsedMs / 1000);
  const days = Math.floor(totalSeconds / 86_400);
  const hours = Math.floor((totalSeconds % 86_400) / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);

  if (days > 0) {
    return `${days}d ${hours}h`;
  }
  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m`;
  }

  return `${totalSeconds}s`;
}
