import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";

interface DeploymentStep {
  id: number;
  label: string;
  detail: string | null;
}

interface DeploymentItem {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  targetServerHost: string;
  sourceType: string;
  commitSha: string | null;
  imageTag: string | null;
  requestedByEmail: string | null;
  status: string;
  steps?: DeploymentStep[];
}

export interface DeploymentListProps {
  session: { data: unknown };
  recentDeployments: { data?: DeploymentItem[] };
  deploymentMessage: string | null;
  canQueueDeployments: boolean;
  refreshOperationalViews: () => Promise<void>;
}

export function DeploymentList({
  session,
  recentDeployments,
  deploymentMessage,
  canQueueDeployments,
  refreshOperationalViews
}: DeploymentListProps) {
  const [serviceName, setServiceName] = useState("edge-worker");
  const [commitSha, setCommitSha] = useState("abcdef1");
  const [imageTag, setImageTag] = useState("ghcr.io/daoflow/edge-worker:0.2.0");
  const [feedback, setFeedback] = useState<string | null>(null);

  const createDeploymentRecord = trpc.createDeploymentRecord.useMutation();

  async function handleCreateDeployment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    try {
      const deployment = await createDeploymentRecord.mutateAsync({
        projectName: "DaoFlow",
        environmentName: "staging",
        serviceName,
        sourceType: "dockerfile",
        targetServerId: "srv_foundation_1",
        commitSha,
        imageTag,
        steps: [
          {
            label: "Render runtime spec",
            detail: `Freeze the Dockerfile inputs for ${serviceName} in staging.`
          },
          {
            label: "Queue execution handoff",
            detail: "Wait for the future execution-plane worker to pick up the job."
          }
        ]
      });

      await refreshOperationalViews();
      setFeedback(`Queued ${deployment.serviceName} as ${deployment.id}.`);
    } catch (error) {
      setFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to queue the deployment record right now."
      );
    }
  }

  return (
    <section className="deployments">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Deployment write-path foundation</p>
        <h2>Queued and historical deployments</h2>
      </div>

      {session.data && canQueueDeployments ? (
        <form
          className="deployment-composer"
          data-testid="manual-deployment-form"
          onSubmit={(event) => void handleCreateDeployment(event)}
        >
          <div>
            <p className="roadmap-item__lane">Safe operator action</p>
            <h3>Queue a deployment record</h3>
            <p className="deployment-card__meta">
              This only creates immutable control-plane records and pending steps. Docker execution
              remains outside the web process.
            </p>
          </div>
          <label>
            Service name
            <input value={serviceName} onChange={(event) => setServiceName(event.target.value)} />
          </label>
          <label>
            Commit SHA
            <input value={commitSha} onChange={(event) => setCommitSha(event.target.value)} />
          </label>
          <label>
            Image tag
            <input value={imageTag} onChange={(event) => setImageTag(event.target.value)} />
          </label>
          <button
            className="action-button"
            disabled={createDeploymentRecord.isPending}
            type="submit"
          >
            {createDeploymentRecord.isPending ? "Queueing..." : "Queue deployment record"}
          </button>
          {feedback ? (
            <p className="auth-feedback" data-testid="deployment-feedback">
              {feedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="viewer-empty">
          Deploy-capable roles can queue immutable deployment records here.
        </p>
      ) : null}

      {session.data && recentDeployments.data ? (
        <div className="deployment-list">
          {recentDeployments.data.map((deployment) => (
            <article
              className="deployment-card"
              data-testid={`deployment-card-${deployment.id}`}
              key={deployment.id}
            >
              <div className="deployment-card__top">
                <div>
                  <p className="roadmap-item__lane">{deployment.environmentName}</p>
                  <h3>{deployment.serviceName}</h3>
                </div>
                <span
                  className={`deployment-status deployment-status--${deployment.status}`}
                  data-testid={`deployment-status-${deployment.id}`}
                >
                  {deployment.status}
                </span>
              </div>
              <p className="deployment-card__meta">
                {deployment.projectName} on {deployment.targetServerName} (
                {deployment.targetServerHost})
              </p>
              <p className="deployment-card__meta">
                Source: {deployment.sourceType} · Commit: {deployment.commitSha} · Image:{" "}
                {deployment.imageTag}
              </p>
              <p className="deployment-card__meta">Requested by {deployment.requestedByEmail}</p>
              {deployment.steps && deployment.steps.length > 0 && (
                <ul className="deployment-card__steps">
                  {deployment.steps.map((step) => (
                    <li key={step.id}>
                      <strong>{step.label}</strong>: {step.detail}
                    </li>
                  ))}
                </ul>
              )}
            </article>
          ))}
        </div>
      ) : (
        <p className="viewer-empty">
          {deploymentMessage ?? "Sign in to inspect deployment records and structured steps."}
        </p>
      )}
    </section>
  );
}
