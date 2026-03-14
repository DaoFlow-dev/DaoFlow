import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";

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
    <section className="compose-release-catalog">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Compose-first targets</p>
        <h2>Compose release catalog</h2>
      </div>

      {session.data && canQueueDeployments && composeReleaseCatalog.data ? (
        <form
          className="compose-release-composer"
          data-testid="compose-release-form"
          onSubmit={(event) => void handleQueueRelease(event)}
        >
          <div>
            <p className="roadmap-item__lane">Typed release queue</p>
            <h3>Queue a compose release</h3>
            <p className="deployment-card__meta">
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
          <button className="action-button" disabled={queueComposeRelease.isPending} type="submit">
            {queueComposeRelease.isPending ? "Queueing..." : "Queue compose release"}
          </button>
          {canRequestApprovals ? (
            <button
              className="action-button action-button--muted"
              disabled={requestApproval.isPending}
              onClick={() => {
                void handleRequestApproval();
              }}
              type="button"
            >
              {requestApproval.isPending ? "Requesting..." : "Request approval"}
            </button>
          ) : null}
          {feedback ? (
            <p className="auth-feedback" data-testid="compose-release-feedback">
              {feedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="viewer-empty">Deploy-capable roles can queue Compose releases here.</p>
      ) : null}

      {session.data && composeReleaseCatalog.data ? (
        <>
          <div className="compose-release-summary" data-testid="compose-release-summary">
            <div className="token-summary__item">
              <span className="metric__label">Services</span>
              <strong>{composeReleaseCatalog.data.summary.totalServices}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Stateful</span>
              <strong>{composeReleaseCatalog.data.summary.statefulServices}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Healthy envs</span>
              <strong>{composeReleaseCatalog.data.summary.healthyEnvironments}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Networks</span>
              <strong>{composeReleaseCatalog.data.summary.uniqueNetworks}</strong>
            </div>
          </div>

          <div className="compose-release-list">
            {composeReleaseCatalog.data.services.map((service) => (
              <article
                className="token-card"
                data-testid={`compose-service-card-${service.id}`}
                key={service.id}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {service.environmentName} · {service.projectName}
                    </p>
                    <h3>{service.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${service.releaseTrack === "stable" ? "healthy" : "running"}`}
                  >
                    {service.releaseTrack}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {service.targetServerName} · {service.composeFilePath}
                </p>
                <p className="deployment-card__meta">
                  Image: {service.imageReference} · Replicas: {service.replicaCount}
                </p>
                <p className="deployment-card__meta">
                  Ports:{" "}
                  {service.exposedPorts.length > 0
                    ? service.exposedPorts.join(", ")
                    : "internal only"}
                </p>
                <p className="deployment-card__meta">
                  Dependencies:{" "}
                  {service.dependencies.length > 0 ? service.dependencies.join(", ") : "none"} ·
                  Network: {service.networkName}
                </p>
                <p className="deployment-card__meta">
                  Volumes: {service.volumeMounts.join(", ")} · Healthcheck:{" "}
                  {service.healthcheckPath ?? "process-level"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {composeReleaseCatalogMessage ??
            "Sign in to inspect Compose release targets and queue rollouts from catalogued topology."}
        </p>
      )}
    </section>
  );
}
