import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ComposeService {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  composeFilePath: string;
  imageReference: string;
  replicaCount: number;
  exposedPorts: string[];
  dependencies: string[];
  networkName: string;
  volumeMounts: string[];
  healthcheckPath: string | null;
  releaseTrack: string;
  releaseTrackTone: string;
  releaseTrackLabel: string;
}

interface ComposeReleaseCatalogData {
  summary: {
    totalServices: number;
    statefulServices: number;
    healthyEnvironments: number;
    uniqueNetworks: number;
  };
  services: ComposeService[];
}

export interface ComposeReleaseCatalogProps {
  session: { data: unknown };
  composeReleaseCatalog: { data?: ComposeReleaseCatalogData };
  composeReleaseCatalogMessage: string | null;
  canQueueDeployments: boolean;
  canRequestApprovals: boolean;
  refreshOperationalViews: () => Promise<void>;
  onApprovalFeedback: (msg: string) => void;
}

export function ComposeReleaseCatalog({
  session,
  composeReleaseCatalog,
  composeReleaseCatalogMessage,
  canQueueDeployments,
  canRequestApprovals,
  refreshOperationalViews,
  onApprovalFeedback
}: ComposeReleaseCatalogProps) {
  const [targetId, setTargetId] = useState("compose_daoflow_prod_control_plane");
  const [commitSha, setCommitSha] = useState("abcdef1");
  const [imageTag, setImageTag] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);

  const queueComposeRelease = trpc.queueComposeRelease.useMutation();
  const requestApproval = trpc.requestApproval.useMutation();

  async function handleQueueRelease(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    try {
      const deployment = (await queueComposeRelease.mutateAsync({
        composeServiceId: targetId,
        commitSha,
        imageTag: imageTag || undefined
      })) as { serviceName: string; id: string } | null;

      await refreshOperationalViews();
      setFeedback(
        deployment
          ? `Queued compose release for ${deployment.serviceName} as ${deployment.id}.`
          : "Compose service not found."
      );
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to queue the compose release right now."
      );
    }
  }

  async function handleRequestApproval() {
    onApprovalFeedback("");

    try {
      const request = await requestApproval.mutateAsync({
        actionType: "compose-release",
        composeServiceId: targetId,
        commitSha,
        imageTag: imageTag || undefined,
        reason: "Require an explicit second reviewer before executing this Compose release."
      });
      await refreshOperationalViews();
      onApprovalFeedback(
        `Requested approval for ${request.actionType} on ${request.targetResource}.`
      );
    } catch (error) {
      onApprovalFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to request approval for this Compose release right now."
      );
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Compose-first targets
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Compose release catalog
        </h2>
      </div>

      {session.data && canQueueDeployments && composeReleaseCatalog.data ? (
        <form
          className="space-y-4"
          data-testid="compose-release-form"
          onSubmit={(event) => void handleQueueRelease(event)}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Typed release queue
            </p>
            <h3 className="text-base font-semibold text-foreground">Queue a compose release</h3>
            <p className="mt-2 text-sm text-muted-foreground">
              Pick a seeded Compose target and queue a rollout with topology-aware steps.
            </p>
          </div>
          <label>
            Release target
            <select value={targetId} onChange={(event) => setTargetId(event.target.value)}>
              {composeReleaseCatalog.data.services.map((service) => (
                <option key={service.id} value={service.id}>
                  {service.projectName} / {service.environmentName} / {service.serviceName}
                </option>
              ))}
            </select>
          </label>
          <label>
            Commit SHA
            <input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
          </label>
          <label>
            Image override
            <input
              value={imageTag}
              onChange={(event) => setImageTag(event.target.value)}
              placeholder="optional override"
            />
          </label>
          <Button disabled={queueComposeRelease.isPending} type="submit">
            {queueComposeRelease.isPending ? "Queueing..." : "Queue compose release"}
          </Button>
          {canRequestApprovals ? (
            <Button
              variant="outline"
              disabled={requestApproval.isPending}
              onClick={() => {
                void handleRequestApproval();
              }}
              type="button"
            >
              {requestApproval.isPending ? "Requesting..." : "Request approval"}
            </Button>
          ) : null}
          {feedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="compose-release-feedback"
            >
              {feedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Deploy-capable roles can queue Compose releases here.
        </p>
      ) : null}

      {session.data && composeReleaseCatalog.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="compose-release-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Services
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeReleaseCatalog.data.summary.totalServices}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Stateful
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeReleaseCatalog.data.summary.statefulServices}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Healthy envs
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeReleaseCatalog.data.summary.healthyEnvironments}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Networks
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {composeReleaseCatalog.data.summary.uniqueNetworks}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {composeReleaseCatalog.data.services.map((service) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`compose-service-card-${service.id}`}
                key={service.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {service.environmentName} · {service.projectName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {service.serviceName}
                    </h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(service.releaseTrackTone)}>
                    {service.releaseTrackLabel}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {service.targetServerName} · {service.composeFilePath}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Image: {service.imageReference} · Replicas: {service.replicaCount}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Ports:{" "}
                  {service.exposedPorts.length > 0
                    ? service.exposedPorts.join(", ")
                    : "internal only"}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Dependencies:{" "}
                  {service.dependencies.length > 0 ? service.dependencies.join(", ") : "none"} ·
                  Network: {service.networkName}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Volumes: {service.volumeMounts.join(", ")} · Healthcheck:{" "}
                  {service.healthcheckPath ?? "process-level"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {composeReleaseCatalogMessage ??
            "Sign in to inspect Compose release targets and queue rollouts from catalogued topology."}
        </p>
      )}
    </section>
  );
}
