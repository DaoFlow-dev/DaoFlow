import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "@/lib/trpc";
import { getExecutionJobTone, getTimelineLifecycle, getTimelineTone } from "@/lib/tone-utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface ExecutionJob {
  id: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  targetServerHost: string;
  queueName: string;
  workerHint: string;
  status: string;
  statusTone?: string;
}

interface ExecutionQueueData {
  summary: {
    totalJobs: number;
    pendingJobs: number;
    completedJobs: number;
    failedJobs: number;
  };
  jobs: ExecutionJob[];
}

interface TimelineEvent {
  id: number;
  resourceType: string;
  kind: string;
  summary: string;
  serviceName: string;
  resourceId: string;
  detail: string | null;
  statusLabel?: string;
  statusTone?: string;
}

export interface ExecutionHandoffProps {
  session: { data: unknown };
  executionQueue: { data?: ExecutionQueueData };
  executionQueueMessage: string | null;
  operationsTimeline: { data?: TimelineEvent[] };
  timelineMessage: string | null;
  canOperateExecutionJobs: boolean;
  refreshOperationalViews: () => Promise<void>;
}

export function ExecutionHandoff({
  session,
  executionQueue,
  executionQueueMessage,
  operationsTimeline,
  timelineMessage,
  canOperateExecutionJobs,
  refreshOperationalViews
}: ExecutionHandoffProps) {
  const [feedback, setFeedback] = useState<string | null>(null);

  const dispatchExecutionJob = trpc.dispatchExecutionJob.useMutation();
  const completeExecutionJob = trpc.completeExecutionJob.useMutation();
  const failExecutionJob = trpc.failExecutionJob.useMutation();

  const mutationPending =
    dispatchExecutionJob.isPending || completeExecutionJob.isPending || failExecutionJob.isPending;

  async function handleDispatchJob(jobId: string, service: string) {
    setFeedback(null);
    try {
      await dispatchExecutionJob.mutateAsync({ jobId });
      await refreshOperationalViews();
      setFeedback(`Dispatched ${service} to the execution worker.`);
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to dispatch the execution job right now."
      );
    }
  }

  async function handleCompleteJob(jobId: string, service: string) {
    setFeedback(null);
    try {
      await completeExecutionJob.mutateAsync({ jobId });
      await refreshOperationalViews();
      setFeedback(`Marked ${service} healthy.`);
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to complete the execution job right now."
      );
    }
  }

  async function handleFailJob(jobId: string, service: string) {
    setFeedback(null);
    try {
      await failExecutionJob.mutateAsync({
        jobId,
        reason: `${service} failed the simulated worker rollout.`
      });
      await refreshOperationalViews();
      setFeedback(`Marked ${service} failed.`);
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to fail the execution job right now."
      );
    }
  }

  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Execution-plane foundation
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Worker handoff queue
        </h2>
      </div>

      {session.data && executionQueue.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="queue-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total jobs
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {executionQueue.data.summary.totalJobs}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pending
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {executionQueue.data.summary.pendingJobs}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Completed
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {executionQueue.data.summary.completedJobs}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Failed
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {executionQueue.data.summary.failedJobs}
              </strong>
            </Card>
          </div>

          {feedback ? (
            <p
              className="rounded-lg border bg-muted px-4 py-2 text-sm text-muted-foreground"
              data-testid="execution-feedback"
            >
              {feedback}
            </p>
          ) : null}

          <div className="grid grid-cols-2 gap-3">
            {executionQueue.data.jobs.map((job) => {
              const statusTone = job.statusTone ?? getExecutionJobTone(job.status);

              return (
                <article
                  className="rounded-xl border bg-card p-5 shadow-sm"
                  data-testid={`execution-job-${job.id}`}
                  key={job.id}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                        {job.environmentName}
                      </p>
                      <h3 className="text-base font-semibold text-foreground">{job.serviceName}</h3>
                    </div>
                    <Badge variant={getBadgeVariantFromTone(statusTone)}>{job.status}</Badge>
                  </div>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Queue: {job.queueName} · Worker hint: {job.workerHint}
                  </p>
                  <p className="mt-2 text-sm text-muted-foreground">
                    {job.projectName} on {job.targetServerName} ({job.targetServerHost})
                  </p>
                  {canOperateExecutionJobs ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {job.status === "pending" ? (
                        <Button
                          disabled={mutationPending}
                          onClick={() => {
                            void handleDispatchJob(job.id, job.serviceName);
                          }}
                          type="button"
                        >
                          Dispatch
                        </Button>
                      ) : null}
                      {job.status === "dispatched" ? (
                        <>
                          <Button
                            disabled={mutationPending}
                            onClick={() => {
                              void handleCompleteJob(job.id, job.serviceName);
                            }}
                            type="button"
                          >
                            Mark healthy
                          </Button>
                          <Button
                            variant="outline"
                            disabled={mutationPending}
                            onClick={() => {
                              void handleFailJob(job.id, job.serviceName);
                            }}
                            type="button"
                          >
                            Mark failed
                          </Button>
                        </>
                      ) : null}
                    </div>
                  ) : null}
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {executionQueueMessage ?? "Sign in to inspect queued worker handoff jobs."}
        </p>
      )}

      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Immutable event feed
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Operations timeline
        </h2>
      </div>

      {session.data && operationsTimeline.data ? (
        <div className="grid grid-cols-2 gap-3">
          {operationsTimeline.data.map((event) => {
            const statusTone = event.statusTone ?? getTimelineTone(event.kind);
            const statusLabel = event.statusLabel ?? getTimelineLifecycle(event.kind);

            return (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`timeline-event-${event.id}`}
                key={event.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {event.resourceType} · {event.kind}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{event.summary}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(statusTone)}>{statusLabel}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {event.serviceName} · {event.resourceId}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">{event.detail}</p>
              </article>
            );
          })}
        </div>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {timelineMessage ?? "Sign in to inspect immutable deployment events."}
        </p>
      )}
    </section>
  );
}
