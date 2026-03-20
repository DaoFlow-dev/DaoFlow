import { useState } from "react";
import type { FormEvent } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

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
  statusTone: string;
  statusLabel: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Deployment write-path foundation
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Queued and historical deployments
        </h2>
      </div>

      {session.data && canQueueDeployments ? (
        <form
          className="space-y-4"
          data-testid="manual-deployment-form"
          onSubmit={(event) => void handleCreateDeployment(event)}
        >
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Safe operator action
            </p>
            <h3 className="text-base font-semibold text-foreground">Queue a deployment record</h3>
            <p className="mt-2 text-sm text-muted-foreground">
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
          <Button disabled={createDeploymentRecord.isPending} type="submit">
            {createDeploymentRecord.isPending ? "Queueing..." : "Queue deployment record"}
          </Button>
          {feedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="deployment-feedback"
            >
              {feedback}
            </p>
          ) : null}
        </form>
      ) : session.data ? (
        <p className="py-10 text-center text-sm text-muted-foreground">
          Deploy-capable roles can queue immutable deployment records here.
        </p>
      ) : null}

      {session.data && recentDeployments.data ? (
        <div className="grid grid-cols-2 gap-3">
          {recentDeployments.data.map((deployment) => (
            <article
              className="rounded-xl border bg-card p-5 shadow-sm"
              data-testid={`deployment-card-${deployment.id}`}
              key={deployment.id}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    {deployment.environmentName}
                  </p>
                  <h3 className="text-base font-semibold text-foreground">
                    {deployment.serviceName}
                  </h3>
                </div>
                <Badge
                  variant={getBadgeVariantFromTone(deployment.statusTone)}
                  data-testid={`deployment-status-${deployment.id}`}
                >
                  {deployment.statusLabel}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {deployment.projectName} on {deployment.targetServerName} (
                {deployment.targetServerHost})
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Source: {deployment.sourceType} · Commit: {deployment.commitSha} · Image:{" "}
                {deployment.imageTag}
              </p>
              <p className="mt-2 text-sm text-muted-foreground">
                Requested by {deployment.requestedByEmail}
              </p>
              {deployment.steps && deployment.steps.length > 0 && (
                <ul className="mt-3 list-disc pl-5 text-sm text-muted-foreground space-y-1">
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
        <p className="py-10 text-center text-sm text-muted-foreground">
          {deploymentMessage ?? "Sign in to inspect deployment records and structured steps."}
        </p>
      )}
    </section>
  );
}
