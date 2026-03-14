import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { trpc } from "../../lib/trpc";
import { getExecutionJobTone, getTimelineLifecycle, getTimelineTone } from "../../lib/tone-utils";

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
    <section className="execution-handoff">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Execution-plane foundation</p>
        <h2>Worker handoff queue</h2>
      </div>

      {session.data && executionQueue.data ? (
        <>
          <div className="queue-summary" data-testid="queue-summary">
            <div className="token-summary__item">
              <span className="metric__label">Total jobs</span>
              <strong>{executionQueue.data.summary.totalJobs}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Pending</span>
              <strong>{executionQueue.data.summary.pendingJobs}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Completed</span>
              <strong>{executionQueue.data.summary.completedJobs}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Failed</span>
              <strong>{executionQueue.data.summary.failedJobs}</strong>
            </div>
          </div>

          {feedback ? (
            <p className="auth-feedback" data-testid="execution-feedback">
              {feedback}
            </p>
          ) : null}

          <div className="queue-list">
            {executionQueue.data.jobs.map((job) => (
              <article className="token-card" data-testid={`execution-job-${job.id}`} key={job.id}>
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">{job.environmentName}</p>
                    <h3>{job.serviceName}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${getExecutionJobTone(job.status)}`}
                  >
                    {job.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  Queue: {job.queueName} · Worker hint: {job.workerHint}
                </p>
                <p className="deployment-card__meta">
                  {job.projectName} on {job.targetServerName} ({job.targetServerHost})
                </p>
                {canOperateExecutionJobs ? (
                  <div className="job-actions">
                    {job.status === "pending" ? (
                      <button
                        className="action-button"
                        disabled={mutationPending}
                        onClick={() => {
                          void handleDispatchJob(job.id, job.serviceName);
                        }}
                        type="button"
                      >
                        Dispatch
                      </button>
                    ) : null}
                    {job.status === "dispatched" ? (
                      <>
                        <button
                          className="action-button"
                          disabled={mutationPending}
                          onClick={() => {
                            void handleCompleteJob(job.id, job.serviceName);
                          }}
                          type="button"
                        >
                          Mark healthy
                        </button>
                        <button
                          className="action-button action-button--muted"
                          disabled={mutationPending}
                          onClick={() => {
                            void handleFailJob(job.id, job.serviceName);
                          }}
                          type="button"
                        >
                          Mark failed
                        </button>
                      </>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {executionQueueMessage ?? "Sign in to inspect queued worker handoff jobs."}
        </p>
      )}

      <div className="roadmap__header">
        <p className="roadmap__kicker">Immutable event feed</p>
        <h2>Operations timeline</h2>
      </div>

      {session.data && operationsTimeline.data ? (
        <div className="timeline-list">
          {operationsTimeline.data.map((event) => (
            <article
              className="timeline-event"
              data-testid={`timeline-event-${event.id}`}
              key={event.id}
            >
              <div className="timeline-event__top">
                <div>
                  <p className="roadmap-item__lane">
                    {event.resourceType} · {event.kind}
                  </p>
                  <h3>{event.summary}</h3>
                </div>
                <span
                  className={`deployment-status deployment-status--${getTimelineTone(event.kind)}`}
                >
                  {getTimelineLifecycle(event.kind)}
                </span>
              </div>
              <p className="deployment-card__meta">
                {event.serviceName} · {event.resourceId}
              </p>
              <p className="deployment-card__meta">{event.detail}</p>
            </article>
          ))}
        </div>
      ) : (
        <p className="viewer-empty">
          {timelineMessage ?? "Sign in to inspect immutable deployment events."}
        </p>
      )}
    </section>
  );
}
