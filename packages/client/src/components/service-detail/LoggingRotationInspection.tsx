import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { RefreshCw } from "lucide-react";
import type {
  ServiceLoggingInspectionStatus,
  ServiceLoggingState,
  ServiceRuntimeLogging
} from "./runtime-config";

export interface LoggingInspectionQuery {
  data?: ServiceLoggingState;
  error?: unknown;
  isFetching: boolean;
  isLoading: boolean;
  refetch: () => Promise<unknown>;
}

interface LoggingRotationInspectionProps {
  serviceId: string;
  desired: ServiceRuntimeLogging | null;
  inspectionQuery: LoggingInspectionQuery;
}

function statusLabel(status: ServiceLoggingInspectionStatus | null): string {
  switch (status) {
    case "not-deployed":
      return "Not deployed";
    case "aligned":
      return "Aligned";
    case "drifted":
      return "Drifted";
    case "mixed":
      return "Mixed";
    case "not-managed":
      return "Not managed";
    case "unavailable":
      return "Unavailable";
    case "unsupported":
      return "Unsupported";
    default:
      return "Not checked";
  }
}

function statusVariant(
  status: ServiceLoggingInspectionStatus | null
): "default" | "secondary" | "success" | "destructive" | "outline" {
  switch (status) {
    case "aligned":
      return "success";
    case "drifted":
    case "mixed":
      return "destructive";
    case "not-deployed":
    case "not-managed":
    case "unavailable":
    case "unsupported":
      return "secondary";
    default:
      return "outline";
  }
}

function statusDescription(status: ServiceLoggingInspectionStatus | null): string {
  switch (status) {
    case "not-deployed":
      return "A desired setting is saved, but no deployed container is available to inspect yet.";
    case "aligned":
      return "Every inspected container matches the desired logging rotation.";
    case "drifted":
      return "The deployed container logging differs from the desired setting. Redeploy after reviewing the source configuration.";
    case "mixed":
      return "The deployed containers do not all use the same logging rotation. Review each container below.";
    case "not-managed":
      return "DaoFlow is not managing log rotation, so active container settings are shown without a pass or fail result.";
    case "unavailable":
      return "Docker inspection is unavailable right now. Refresh to try again.";
    case "unsupported":
      return "Live Docker log inspection is not supported for this service type.";
    default:
      return "Live inspection has not run yet. Refresh active settings to inspect the deployed containers.";
  }
}

function formatInspectionTime(value: string | null): string {
  if (!value) {
    return "Not inspected yet";
  }

  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function formatContainerValue(value: string | null): string {
  return value ?? "Not set";
}

export function LoggingRotationInspection({
  serviceId,
  desired,
  inspectionQuery
}: LoggingRotationInspectionProps) {
  const inspectionStatus =
    inspectionQuery.data?.status ?? (inspectionQuery.error ? "unavailable" : null);
  const isSwarmUnsupported =
    inspectionQuery.data?.status === "unsupported" ||
    inspectionQuery.data?.reason?.toLowerCase().includes("swarm") === true;

  async function refreshInspection() {
    await inspectionQuery.refetch();
  }

  return (
    <section
      className="flex flex-col gap-3"
      aria-labelledby={`service-logging-inspection-heading-${serviceId}`}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3
            className="text-sm font-medium"
            id={`service-logging-inspection-heading-${serviceId}`}
            data-testid={`service-logging-inspection-heading-${serviceId}`}
          >
            Deployed container inspection
          </h3>
          <p className="text-xs text-muted-foreground">
            This reflects the containers currently running on the target server.
          </p>
        </div>
        <Button
          size="sm"
          variant="outline"
          onClick={() => void refreshInspection()}
          disabled={inspectionQuery.isFetching}
          data-testid={`service-logging-refresh-${serviceId}`}
        >
          <RefreshCw data-icon="inline-start" />
          {inspectionQuery.isFetching ? "Refreshing..." : "Refresh active settings"}
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 rounded-md border p-3 md:grid-cols-3">
        <div className="flex flex-col gap-1" data-testid={`service-logging-desired-${serviceId}`}>
          <span className="text-xs text-muted-foreground">Desired state</span>
          <span className="text-sm font-medium">
            {desired
              ? `${desired.driver}, ${desired.maxSizeMb} MB, ${desired.maxFiles} files`
              : "Not managed"}
          </span>
          <span className="text-xs text-muted-foreground">
            {desired
              ? desired.allowSourceOverride
                ? "DaoFlow may replace source logging"
                : "Source logging is preserved"
              : "Source-authored logging is preserved"}
          </span>
        </div>
        <div className="flex flex-col gap-1" data-testid={`service-logging-status-${serviceId}`}>
          <span className="text-xs text-muted-foreground">Inspection status</span>
          <Badge
            variant={statusVariant(inspectionStatus)}
            data-testid={`service-logging-status-value-${serviceId}`}
          >
            {statusLabel(inspectionStatus)}
          </Badge>
          <span className="text-xs text-muted-foreground">
            {isSwarmUnsupported
              ? "Docker log rotation inspection is not supported for Swarm services."
              : (inspectionQuery.data?.reason ?? statusDescription(inspectionStatus))}
          </span>
        </div>
        <div
          className="flex flex-col gap-1"
          data-testid={`service-logging-inspected-at-${serviceId}`}
        >
          <span className="text-xs text-muted-foreground">Inspected at</span>
          <span className="text-sm font-medium">
            {formatInspectionTime(inspectionQuery.data?.inspectedAt ?? null)}
          </span>
        </div>
      </div>

      {inspectionQuery.isLoading ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`service-logging-inspection-loading-${serviceId}`}
        >
          Loading container inspection...
        </p>
      ) : inspectionQuery.data?.containers.length ? (
        <Table data-testid={`service-logging-containers-${serviceId}`}>
          <TableHeader>
            <TableRow>
              <TableHead>Container</TableHead>
              <TableHead>Driver</TableHead>
              <TableHead>Max size</TableHead>
              <TableHead>Max files</TableHead>
              <TableHead>Result</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {inspectionQuery.data.containers.map((container) => (
              <TableRow
                key={container.name}
                data-testid={`service-logging-container-${serviceId}-${container.name}`}
              >
                <TableCell
                  data-testid={`service-logging-container-name-${serviceId}-${container.name}`}
                >
                  {container.name}
                </TableCell>
                <TableCell
                  data-testid={`service-logging-container-driver-${serviceId}-${container.name}`}
                >
                  {formatContainerValue(container.driver)}
                </TableCell>
                <TableCell
                  data-testid={`service-logging-container-size-${serviceId}-${container.name}`}
                >
                  {formatContainerValue(container.maxSize)}
                </TableCell>
                <TableCell
                  data-testid={`service-logging-container-files-${serviceId}-${container.name}`}
                >
                  {formatContainerValue(container.maxFiles)}
                </TableCell>
                <TableCell
                  data-testid={`service-logging-container-match-${serviceId}-${container.name}`}
                >
                  <Badge
                    variant={
                      container.matchesDesired === null
                        ? "secondary"
                        : container.matchesDesired
                          ? "success"
                          : "destructive"
                    }
                  >
                    {container.matchesDesired === null
                      ? "Not compared"
                      : container.matchesDesired
                        ? "Matches desired"
                        : "Differs"}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      ) : (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`service-logging-no-containers-${serviceId}`}
        >
          {isSwarmUnsupported
            ? "Docker log rotation inspection is not supported for Swarm services."
            : inspectionStatus === null
              ? "Live Docker inspection has not run yet. Refresh active settings when you want to check deployed containers."
              : inspectionStatus === "not-deployed"
                ? "No deployed containers are available yet. Deploy the service, then refresh this inspection."
                : inspectionStatus === "unavailable"
                  ? "Container inspection is unavailable. Refresh to try again."
                  : "No deployed containers were returned by the inspection."}
        </p>
      )}
    </section>
  );
}
