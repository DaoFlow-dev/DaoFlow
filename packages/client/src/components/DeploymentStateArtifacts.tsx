import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";
import type { DeploymentStateArtifactsData } from "@/pages/deployments-page/types";
import { Copy, Download, FileJson, Layers3, RadioTower, ScrollText } from "lucide-react";

interface DeploymentStateArtifactsProps {
  artifacts: DeploymentStateArtifactsData | null | undefined;
  deploymentId: string;
}

function formatList(values: string[]) {
  return values.length > 0 ? values.join(", ") : "—";
}

function formatDate(value: string | null | undefined) {
  return value ? new Date(value).toLocaleString() : "—";
}

function formatRepoLabel(input: DeploymentStateArtifactsData["declaredConfig"]) {
  return input.repoFullName || input.repoUrl || "—";
}

function formatReadinessSummary(
  readinessProbe: DeploymentStateArtifactsData["effectiveDeployment"]["readinessProbe"]
) {
  if (!readinessProbe) {
    return "No explicit readiness probe captured.";
  }

  const pathSegment = readinessProbe.path ? ` ${readinessProbe.path}` : "";
  return `${readinessProbe.type.toUpperCase()} ${readinessProbe.target} ${readinessProbe.port}${pathSegment}`;
}

export function DeploymentStateArtifacts({
  artifacts,
  deploymentId
}: DeploymentStateArtifactsProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) {
      return;
    }

    const timeout = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(timeout);
  }, [copied]);

  if (!artifacts) {
    return null;
  }

  const exportText = JSON.stringify(artifacts, null, 2);

  function handleCopy() {
    void navigator.clipboard.writeText(exportText).then(() => setCopied(true));
  }

  function handleDownload() {
    const blob = new Blob([exportText], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `deployment-${deploymentId}-state.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <section
      className="space-y-3 rounded-xl border border-border/60 bg-background/80 p-4"
      data-testid={`deployment-state-artifacts-${deploymentId}`}
    >
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="space-y-1">
          <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Runtime Transparency
          </p>
          <h4 className="text-sm font-semibold text-foreground">
            Declared config, frozen deployment input, and last observed live state
          </h4>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleCopy}
            data-testid={`deployment-state-copy-${deploymentId}`}
          >
            <Copy size={14} className="mr-1" />
            {copied ? "Copied" : "Copy JSON"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleDownload}
            data-testid={`deployment-state-download-${deploymentId}`}
          >
            <Download size={14} className="mr-1" />
            Download JSON
          </Button>
        </div>
      </div>

      <div className="grid gap-3 xl:grid-cols-3">
        <article
          className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4"
          data-testid={`deployment-state-declared-${deploymentId}`}
        >
          <div className="flex items-center gap-2">
            <ScrollText size={14} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Declared config</p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Source lane: {artifacts.declaredConfig.sourceType}</p>
            <p>Repository: {formatRepoLabel(artifacts.declaredConfig)}</p>
            <p>Branch: {artifacts.declaredConfig.branch ?? "—"}</p>
            <p>Compose files: {formatList(artifacts.declaredConfig.composeFiles)}</p>
            <p>Profiles: {formatList(artifacts.declaredConfig.composeProfiles)}</p>
            <p>Compose service: {artifacts.declaredConfig.composeServiceName ?? "—"}</p>
            <p>Stack name: {artifacts.declaredConfig.stackName ?? "—"}</p>
            <p>Target: {artifacts.declaredConfig.targetServerName ?? "—"}</p>
          </div>
        </article>

        <article
          className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4"
          data-testid={`deployment-state-effective-${deploymentId}`}
        >
          <div className="flex items-center gap-2">
            <Layers3 size={14} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Frozen deployment input</p>
          </div>
          <div className="space-y-1 text-sm text-muted-foreground">
            <p>Compose operation: {artifacts.effectiveDeployment.composeOperation ?? "up"}</p>
            <p>Compose env branch: {artifacts.effectiveDeployment.composeEnvBranch ?? "—"}</p>
            <p>
              Readiness gate: {formatReadinessSummary(artifacts.effectiveDeployment.readinessProbe)}
            </p>
            <p>
              Image override:{" "}
              {artifacts.effectiveDeployment.imageOverride?.imageReference ??
                "No override captured."}
            </p>
            <p>
              Env evidence:{" "}
              {artifacts.effectiveDeployment.composeEnv
                ? `${artifacts.effectiveDeployment.composeEnv.counts.total} entries (${artifacts.effectiveDeployment.composeEnv.counts.secrets} secret)`
                : "No Compose env evidence saved."}
            </p>
            <p>
              Preview stack:{" "}
              {artifacts.effectiveDeployment.preview?.stackName ?? "No preview metadata."}
            </p>
            <p>
              Runtime override preview:{" "}
              {artifacts.effectiveDeployment.runtimeConfigPreview ? "available" : "none"}
            </p>
            <p>
              Replayable keys:{" "}
              {Object.keys(artifacts.effectiveDeployment.replayableSnapshot).length}
            </p>
          </div>
        </article>

        <article
          className="space-y-2 rounded-lg border border-border/60 bg-muted/10 p-4"
          data-testid={`deployment-state-live-${deploymentId}`}
        >
          <div className="flex items-center gap-2">
            <RadioTower size={14} className="text-muted-foreground" />
            <p className="text-sm font-semibold text-foreground">Last observed live state</p>
          </div>
          {artifacts.liveRuntime ? (
            <>
              <div className="flex items-center gap-2">
                <Badge variant={getBadgeVariantFromTone(artifacts.liveRuntime.statusTone)}>
                  {artifacts.liveRuntime.statusLabel}
                </Badge>
                <span className="text-xs text-muted-foreground">
                  Checked {formatDate(artifacts.liveRuntime.checkedAt)}
                </span>
              </div>
              <div className="space-y-1 text-sm text-muted-foreground">
                <p data-testid={`deployment-state-live-summary-${deploymentId}`}>
                  {artifacts.liveRuntime.summary}
                </p>
                <p>Container state: {artifacts.liveRuntime.actualContainerState ?? "—"}</p>
                <p>Desired image: {artifacts.liveRuntime.desiredImageReference ?? "—"}</p>
                <p>Actual image: {artifacts.liveRuntime.actualImageReference ?? "—"}</p>
                <p>
                  Desired replicas: {artifacts.liveRuntime.desiredReplicaCount ?? "—"} · Actual
                  replicas: {artifacts.liveRuntime.actualReplicaCount ?? "—"}
                </p>
                {artifacts.liveRuntime.impactSummary ? (
                  <p>Impact: {artifacts.liveRuntime.impactSummary}</p>
                ) : null}
              </div>
              {artifacts.liveRuntime.recommendedActions.length > 0 ? (
                <div className="space-y-1 text-sm text-muted-foreground">
                  <p className="font-medium text-foreground">Recommended next steps</p>
                  <ul className="space-y-1 pl-4">
                    {artifacts.liveRuntime.recommendedActions.map((action) => (
                      <li key={action} className="list-disc">
                        {action}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              {artifacts.liveRuntime.diffs.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {artifacts.liveRuntime.diffs.map((diff) => (
                    <Badge
                      key={`${diff.field}-${diff.actualValue}`}
                      variant="outline"
                      className="text-[10px]"
                    >
                      {diff.field}: {diff.desiredValue}
                      {" -> "}
                      {diff.actualValue}
                    </Badge>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div className="space-y-2 text-sm text-muted-foreground">
              <p>No live runtime observation is attached to this deployment yet.</p>
              <p>
                DaoFlow will show the last observed container state here once drift inspection data
                is available for the service environment.
              </p>
            </div>
          )}
        </article>
      </div>

      <details
        className="rounded-lg border border-border/60 bg-muted/10 p-3"
        data-testid={`deployment-state-raw-${deploymentId}`}
      >
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium text-foreground">
          <FileJson size={14} className="text-muted-foreground" />
          Raw exported JSON
        </summary>
        <pre className="mt-3 overflow-x-auto rounded-md bg-background p-3 text-xs text-muted-foreground">
          {exportText}
        </pre>
      </details>
    </section>
  );
}
