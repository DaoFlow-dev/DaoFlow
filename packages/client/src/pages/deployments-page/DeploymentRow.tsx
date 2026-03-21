import { Fragment, memo } from "react";
import { ChevronDown, ChevronRight, RefreshCw, RotateCcw, XCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { TableCell, TableRow } from "@/components/ui/table";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import { DeploymentExpandedDetails } from "./DeploymentExpandedDetails";
import type { DeploymentRowData } from "./types";
import { formatRelative } from "./utils";

export interface DeploymentRowProps {
  deployment: DeploymentRowData;
  isExpanded: boolean;
  cancelPending: boolean;
  onToggleExpand: (deploymentId: string) => void;
  onOpenRollback: (serviceId: string) => void;
  onCancelDeployment: (deploymentId: string) => void;
}

export const DeploymentRow = memo(function DeploymentRow({
  deployment,
  isExpanded,
  cancelPending,
  onToggleExpand,
  onOpenRollback,
  onCancelDeployment
}: DeploymentRowProps) {
  const id = String(deployment.id);
  const lifecycleStatus =
    typeof deployment.lifecycleStatus === "string"
      ? deployment.lifecycleStatus
      : String(deployment.status);
  const isSuccessful = deployment.canRollback === true && typeof deployment.serviceId === "string";

  return (
    <Fragment>
      <TableRow
        className="cursor-pointer transition-colors hover:bg-muted/40"
        onClick={() => onToggleExpand(id)}
      >
        <TableCell className="px-2">
          {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </TableCell>
        <TableCell className="font-medium">
          {String(deployment.serviceName ?? deployment.projectId ?? "—")}
          <div className="text-xs font-normal text-muted-foreground">
            {String(deployment.environmentName ?? "unknown environment")} on{" "}
            {String(deployment.targetServerName ?? "unknown server")}
          </div>
        </TableCell>
        <TableCell>
          <div className="flex flex-col gap-1">
            <Badge variant={getBadgeVariantFromTone(String(deployment.statusTone))}>
              {String(deployment.statusLabel)}
            </Badge>
            <span className="text-xs text-muted-foreground">Lifecycle: {lifecycleStatus}</span>
          </div>
        </TableCell>
        <TableCell className="text-muted-foreground">
          {String(deployment.sourceType ?? "docker")}
        </TableCell>
        <TableCell
          className="text-muted-foreground"
          title={deployment.createdAt ? new Date(deployment.createdAt).toLocaleString() : undefined}
        >
          {formatRelative(deployment.createdAt ?? null)}
        </TableCell>
        <TableCell className="text-right">
          {isSuccessful ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Rollback deployment"
              onClick={(event) => {
                event.stopPropagation();
                onOpenRollback(String(deployment.serviceId));
              }}
            >
              <RotateCcw size={14} className="mr-1" />
              Rollback
            </Button>
          ) : null}
          {typeof deployment.conclusion === "string" && deployment.conclusion === "failure" ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label="Retry failed deployment"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <RefreshCw size={14} className="mr-1" />
              Retry
            </Button>
          ) : null}
          {lifecycleStatus === "queued" || lifecycleStatus === "running" ? (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              aria-label="Cancel deployment"
              disabled={cancelPending}
              onClick={(event) => {
                event.stopPropagation();
                onCancelDeployment(id);
              }}
            >
              <XCircle size={14} className="mr-1" />
              Cancel
            </Button>
          ) : null}
        </TableCell>
      </TableRow>
      {isExpanded ? (
        <TableRow>
          <TableCell colSpan={6} className="p-0">
            <DeploymentExpandedDetails deployment={deployment} deploymentId={id} />
          </TableCell>
        </TableRow>
      ) : null}
    </Fragment>
  );
});

DeploymentRow.displayName = "DeploymentRow";
