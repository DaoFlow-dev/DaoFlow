import type { ExecutionTarget } from "./execution-target";
import {
  collectCommand,
  collectDockerJsonLines,
  parseDockerDiskUsage,
  type DockerDiskUsageEntry
} from "./server-host-command";

export interface HostResourceSnapshot {
  cpu: {
    cores: number | null;
    load1: number | null;
    loadPercent: number | null;
  };
  memory: {
    totalMb: number | null;
    availableMb: number | null;
    usedPercent: number | null;
  };
  disk: {
    mount: string;
    totalGb: number | null;
    usedGb: number | null;
    availableGb: number | null;
    usedPercent: number | null;
  };
  docker: {
    reachable: boolean;
    diskUsage: DockerDiskUsageEntry[];
    summary: string;
  };
  checkedAt: string;
}

export interface CleanupPreview {
  exitedContainers: number;
  danglingImages: number;
  buildCacheItems: number;
  volumesIncluded: boolean;
  dockerDiskUsage: DockerDiskUsageEntry[];
  commands: string[];
}

export interface CleanupRunResult extends CleanupPreview {
  commandResults: Array<{ command: string; exitCode: number; output: string[] }>;
}

export interface PatchPlan {
  status: "available" | "none" | "unsupported";
  packageManager: "apt" | "apk" | "dnf" | "yum" | "unknown";
  packageCount: number;
  packages: string[];
  summary: string;
}

function readKeyValue(lines: string[]) {
  const values = new Map<string, string>();
  for (const line of lines) {
    const index = line.indexOf("=");
    if (index > 0) {
      values.set(line.slice(0, index), line.slice(index + 1));
    }
  }
  return values;
}

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.replace(/%$/, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function kbToMb(value: number | null) {
  return value === null ? null : Math.round(value / 1024);
}

function kbToGb(value: number | null) {
  return value === null ? null : Math.round((value / 1024 / 1024) * 10) / 10;
}

export async function collectHostResourceSnapshot(
  target: ExecutionTarget
): Promise<HostResourceSnapshot> {
  const resourceResult = await collectCommand(
    target,
    [
      'printf "cpu_count=%s\\n" "$(getconf _NPROCESSORS_ONLN 2>/dev/null || nproc 2>/dev/null || echo 0)"',
      'awk "{ if (NR == 1) print \\"load1=\\" \\$1 }" /proc/loadavg 2>/dev/null || true',
      'awk "/^MemTotal:/ {print \\"mem_total_kb=\\"\\$2} /^MemAvailable:/ {print \\"mem_available_kb=\\"\\$2}" /proc/meminfo 2>/dev/null || true',
      'df -Pk / | awk "NR == 2 {print \\"disk_total_kb=\\"\\$2\\"\\ndisk_used_kb=\\"\\$3\\"\\ndisk_available_kb=\\"\\$4\\"\\ndisk_percent=\\"\\$5}"'
    ].join("; ")
  );
  const dockerResult = await collectDockerJsonLines(target, ["system", "df", "--format", "json"]);
  const values = readKeyValue(resourceResult.stdout);
  const cores = parseNumber(values.get("cpu_count"));
  const load1 = parseNumber(values.get("load1"));
  const memTotalKb = parseNumber(values.get("mem_total_kb"));
  const memAvailableKb = parseNumber(values.get("mem_available_kb"));
  const diskTotalKb = parseNumber(values.get("disk_total_kb"));
  const diskUsedKb = parseNumber(values.get("disk_used_kb"));
  const diskAvailableKb = parseNumber(values.get("disk_available_kb"));
  const diskPercent = parseNumber(values.get("disk_percent"));
  const memoryUsedPercent =
    memTotalKb && memAvailableKb !== null
      ? Math.round(((memTotalKb - memAvailableKb) / memTotalKb) * 100)
      : null;

  return {
    cpu: {
      cores,
      load1,
      loadPercent: cores && load1 !== null ? Math.round((load1 / cores) * 100) : null
    },
    memory: {
      totalMb: kbToMb(memTotalKb),
      availableMb: kbToMb(memAvailableKb),
      usedPercent: memoryUsedPercent
    },
    disk: {
      mount: "/",
      totalGb: kbToGb(diskTotalKb),
      usedGb: kbToGb(diskUsedKb),
      availableGb: kbToGb(diskAvailableKb),
      usedPercent: diskPercent
    },
    docker: {
      reachable: dockerResult.exitCode === 0,
      diskUsage: dockerResult.exitCode === 0 ? parseDockerDiskUsage(dockerResult.stdout) : [],
      summary:
        dockerResult.exitCode === 0
          ? "Docker disk usage collected."
          : [...dockerResult.stderr, ...dockerResult.stdout].join(" ").trim()
    },
    checkedAt: new Date().toISOString()
  };
}

export async function previewHostCleanup(
  target: ExecutionTarget,
  input?: { includeVolumes?: boolean }
): Promise<CleanupPreview> {
  const [containers, images, cache, disk] = await Promise.all([
    collectDockerJsonLines(target, ["container", "ls", "-aq", "--filter", "status=exited"]),
    collectDockerJsonLines(target, ["images", "-q", "--filter", "dangling=true"]),
    collectDockerJsonLines(target, ["builder", "du", "--verbose"]),
    collectDockerJsonLines(target, ["system", "df", "--format", "json"])
  ]);

  const commands = [
    "docker container prune -f",
    "docker image prune -f",
    "docker builder prune -f"
  ];
  if (input?.includeVolumes) {
    commands.push("docker volume prune -f");
  }

  return {
    exitedContainers: containers.exitCode === 0 ? containers.stdout.length : 0,
    danglingImages: images.exitCode === 0 ? images.stdout.length : 0,
    buildCacheItems: cache.exitCode === 0 ? cache.stdout.length : 0,
    volumesIncluded: input?.includeVolumes === true,
    dockerDiskUsage: disk.exitCode === 0 ? parseDockerDiskUsage(disk.stdout) : [],
    commands
  };
}

export async function runHostCleanup(
  target: ExecutionTarget,
  input?: { includeVolumes?: boolean }
): Promise<CleanupRunResult> {
  const preview = await previewHostCleanup(target, input);
  const commandResults: CleanupRunResult["commandResults"] = [];

  for (const command of preview.commands) {
    const result = await collectCommand(target, command);
    commandResults.push({
      command,
      exitCode: result.exitCode,
      output: [...result.stdout, ...result.stderr].slice(0, 80)
    });
  }

  return { ...preview, commandResults };
}

export async function planHostPatches(target: ExecutionTarget): Promise<PatchPlan> {
  const result = await collectCommand(
    target,
    [
      "if command -v apt-get >/dev/null 2>&1; then apt-get -s upgrade 2>/dev/null | awk '/^Inst / {print $2}' | head -100 | sed 's/^/apt:/'; exit 0; fi",
      "if command -v apk >/dev/null 2>&1; then apk version -l '<' 2>/dev/null | head -100 | sed 's/^/apk:/'; exit 0; fi",
      "if command -v dnf >/dev/null 2>&1; then dnf check-update -q 2>/dev/null | awk 'NF>=3 {print \"dnf:\"$1}' | head -100; exit 0; fi",
      "if command -v yum >/dev/null 2>&1; then yum check-update -q 2>/dev/null | awk 'NF>=3 {print \"yum:\"$1}' | head -100; exit 0; fi",
      "echo unknown:"
    ].join("; ")
  );
  const packages = result.stdout
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.endsWith(":"));
  const manager = packages[0]?.split(":")[0] ?? result.stdout[0]?.replace(":", "") ?? "unknown";

  return {
    status: manager === "unknown" ? "unsupported" : packages.length > 0 ? "available" : "none",
    packageManager: ["apt", "apk", "dnf", "yum"].includes(manager)
      ? (manager as PatchPlan["packageManager"])
      : "unknown",
    packageCount: packages.length,
    packages: packages.map((line) => line.replace(/^[^:]+:/, "")),
    summary:
      manager === "unknown"
        ? "No supported package manager was detected."
        : `${packages.length} package update${packages.length === 1 ? "" : "s"} detected.`
  };
}
