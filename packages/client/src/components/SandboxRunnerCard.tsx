import {
  Archive,
  Cpu,
  Download,
  HardDrive,
  MemoryStick,
  Play,
  Radio,
  Terminal,
  type LucideIcon
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";

type SandboxRunnerProfile = {
  id: string;
  name: string;
  provider: string | null;
  status: string;
  image: string | null;
  cpuLimit: number | null;
  memoryLimitMb: number | null;
  diskLimitMb: number | null;
  codexAuthMode: string | null;
  allowedCommands?: unknown;
  capabilities: unknown;
  validationCommands?: unknown;
};

type RunnerAction = {
  capability: string;
  icon: LucideIcon;
  label: string;
};

const RUNNER_ACTIONS: RunnerAction[] = [
  { capability: "exec", icon: Play, label: "Run" },
  { capability: "exec.stream", icon: Radio, label: "Stream" },
  { capability: "files.read", icon: Download, label: "Read files" },
  { capability: "files.write", icon: Archive, label: "Write files" },
  { capability: "archive.upload", icon: Archive, label: "Upload archive" },
  { capability: "archive.download", icon: Download, label: "Download archive" },
  { capability: "snapshot", icon: HardDrive, label: "Snapshot" },
  { capability: "port.expose", icon: Radio, label: "Expose port" },
  { capability: "terminal", icon: Terminal, label: "Terminal" },
  { capability: "sleep", icon: MemoryStick, label: "Sleep" }
];

function formatLabel(value: string | null | undefined) {
  return value?.replaceAll("_", " ") ?? "unassigned";
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export function SandboxRunnerCard({ profile }: { profile: SandboxRunnerProfile }) {
  const commands = readStringList(profile.validationCommands);
  const allowedCommands = readStringList(profile.allowedCommands);
  const capabilities = readStringList(profile.capabilities);
  const capabilitySet = new Set(capabilities);

  return (
    <div className="min-w-0 rounded-md border p-3" data-testid={`sandbox-runner-${profile.id}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{profile.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatLabel(profile.provider)} · {formatLabel(profile.codexAuthMode)}
          </p>
        </div>
        <Badge variant={getInventoryBadgeVariant(profile.status)}>{profile.status}</Badge>
      </div>
      <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
        <span className="inline-flex items-center gap-1">
          <Cpu size={12} /> {profile.cpuLimit} CPU
        </span>
        <span className="inline-flex items-center gap-1">
          <MemoryStick size={12} /> {profile.memoryLimitMb} MB
        </span>
        <span className="inline-flex items-center gap-1">
          <HardDrive size={12} /> {profile.diskLimitMb} MB
        </span>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" aria-label={`${profile.name} runner actions`}>
        {RUNNER_ACTIONS.map((action) => {
          const Icon = action.icon;
          const available = capabilitySet.has(action.capability);
          return (
            <Button
              key={action.capability}
              type="button"
              variant={available ? "outline" : "ghost"}
              size="icon"
              disabled={!available}
              aria-label={`${action.label} ${available ? "available" : "unavailable"}`}
              data-testid={`sandbox-runner-action-${profile.id}-${action.capability}`}
              className="size-8"
            >
              <Icon size={14} />
            </Button>
          );
        })}
      </div>
      <p className="mt-2 break-all text-xs text-muted-foreground">
        Image: <span className="font-mono">{profile.image}</span>
      </p>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        Validation: {commands.length > 0 ? commands.join(", ") : "not configured"}
      </p>
      <p className="mt-1 flex items-start gap-1 break-words text-xs text-muted-foreground">
        <Terminal size={12} className="mt-0.5 shrink-0" />
        <span>
          Allowed: {allowedCommands.length > 0 ? allowedCommands.join(", ") : "profile only"}
        </span>
      </p>
      <p className="mt-1 break-words text-xs text-muted-foreground">
        Capabilities: {capabilities.length > 0 ? capabilities.join(", ") : "not reported"}
      </p>
    </div>
  );
}
