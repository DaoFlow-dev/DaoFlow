import { CheckCircle2, TriangleAlert, XCircle } from "lucide-react";
import { getServerReadinessTone } from "@/lib/tone-utils";
import { cn } from "@/lib/utils";

interface ServerReadinessIndicatorProps {
  readinessStatus: string;
  dataTestId: string;
  className?: string;
}

function getServerReadinessPresentation(readinessStatus: string) {
  const normalizedStatus = readinessStatus.trim().toLowerCase();
  const tone = getServerReadinessTone(readinessStatus);
  const blocked = normalizedStatus === "blocked" || tone === "failed";

  if (blocked) {
    return {
      label: "Blocked",
      detail: "Connectivity is blocked for this host",
      icon: XCircle,
      className:
        "border-destructive/20 bg-destructive/10 text-destructive dark:border-destructive/30 dark:text-red-300"
    };
  }

  if (tone === "running") {
    return {
      label: "Attention",
      detail: "Needs review before the next rollout",
      icon: TriangleAlert,
      className:
        "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:border-amber-400/30 dark:text-amber-300"
    };
  }

  return {
    label: "Ready",
    detail: "Connected and ready for deployments",
    icon: CheckCircle2,
    className:
      "border-emerald-500/20 bg-emerald-500/10 text-emerald-700 dark:border-emerald-400/30 dark:text-emerald-300"
  };
}

export function ServerReadinessIndicator({
  readinessStatus,
  dataTestId,
  className
}: ServerReadinessIndicatorProps) {
  const presentation = getServerReadinessPresentation(readinessStatus);
  const Icon = presentation.icon;

  return (
    <span
      role="status"
      aria-label={`Server status: ${presentation.label}. ${presentation.detail}.`}
      data-testid={dataTestId}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        presentation.className,
        className
      )}
    >
      <Icon size={14} aria-hidden="true" />
      <span>{presentation.label}</span>
    </span>
  );
}
