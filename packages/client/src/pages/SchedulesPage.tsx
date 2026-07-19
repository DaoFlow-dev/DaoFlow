import { useState } from "react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

type SchedulerLeaseStatus = {
  key: string;
  holderInstanceId: string;
  generation: number;
  acquiredAt: string;
  renewedAt: string;
  expiresAt: string;
  active: boolean;
  leaseAgeMs: number;
  renewalAgeMs: number;
  expiresInMs: number;
};

function formatDuration(durationMs: number) {
  const totalSeconds = Math.max(0, Math.round(durationMs / 1_000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

export function SchedulerLeaseCard({ status }: { status: SchedulerLeaseStatus | null }) {
  const state = status?.active ? "Active leader" : status ? "Lease expired" : "No lease recorded";

  return (
    <Card data-testid="scheduler-lease-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardTitle className="text-base">Scheduler leadership</CardTitle>
          <Badge variant={status?.active ? "default" : "outline"} data-testid="scheduler-state">
            {state}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {status ? (
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">Instance</dt>
              <dd className="break-all font-mono" data-testid="scheduler-instance">
                {status.holderInstanceId}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Generation</dt>
              <dd data-testid="scheduler-generation">{status.generation}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Lease age</dt>
              <dd data-testid="scheduler-lease-age">{formatDuration(status.leaseAgeMs)}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Last renewal</dt>
              <dd data-testid="scheduler-renewal-age">{formatDuration(status.renewalAgeMs)} ago</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">Acquired</dt>
              <dd data-testid="scheduler-acquired-at">
                {new Date(status.acquiredAt).toLocaleString()}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-muted-foreground">
                {status.active ? "Expires without renewal" : "Expired"}
              </dt>
              <dd data-testid="scheduler-expires-at">
                {new Date(status.expiresAt).toLocaleString()}
                {status.active ? ` (${formatDuration(status.expiresInMs)})` : ""}
              </dd>
            </div>
          </dl>
        ) : (
          <p className="text-sm text-muted-foreground" data-testid="scheduler-empty">
            No control-plane instance has acquired the service scheduler lease yet.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SchedulesPage() {
  const utils = trpc.useUtils();
  const session = useSession();
  const schedules = trpc.serviceSchedules.useQuery(
    { limit: 100 },
    { enabled: Boolean(session.data), refetchInterval: 10_000 }
  );
  const schedulerLease = trpc.serviceScheduleMonitorStatus.useQuery(undefined, {
    enabled: Boolean(session.data),
    refetchInterval: 10_000
  });
  const setScheduleState = trpc.setServiceScheduleState.useMutation();
  const deleteSchedule = trpc.deleteServiceSchedule.useMutation();
  const runScheduleNow = trpc.runServiceScheduleNow.useMutation();
  const [feedback, setFeedback] = useState<string | null>(null);
  const rows = schedules.data ?? [];

  async function refreshOperationalViews() {
    await utils.serviceSchedules.invalidate({ limit: 100 });
  }

  async function mutateSchedule(scheduleId: string, action: "pause" | "resume" | "run" | "delete") {
    setFeedback(null);
    if (
      action === "delete" &&
      !window.confirm("Delete this schedule? Future runs will stop immediately.")
    ) {
      return;
    }
    try {
      if (action === "run") await runScheduleNow.mutateAsync({ scheduleId });
      if (action === "delete") await deleteSchedule.mutateAsync({ scheduleId });
      if (action === "pause" || action === "resume") {
        await setScheduleState.mutateAsync({ scheduleId, state: action });
      }
      await refreshOperationalViews();
      setFeedback(`${action[0]?.toUpperCase()}${action.slice(1)} completed.`);
    } catch (error) {
      setFeedback(messageFromError(error, `Unable to ${action} the schedule.`));
    }
  }

  return (
    <main className="shell space-y-6" data-testid="schedules-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Schedules</h1>
        <p className="text-sm text-muted-foreground">
          Recurring service tasks, run state, and manual operations.
        </p>
      </div>

      {feedback ? (
        <p
          className="rounded-md border bg-muted px-3 py-2 text-sm"
          data-testid="schedules-feedback"
        >
          {feedback}
        </p>
      ) : null}

      {schedulerLease.isLoading ? (
        <Skeleton className="h-44 w-full" data-testid="scheduler-lease-loading" />
      ) : schedulerLease.error ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          data-testid="scheduler-lease-error"
        >
          {messageFromError(schedulerLease.error, "Unable to load scheduler leadership.")}
        </p>
      ) : (
        <SchedulerLeaseCard status={schedulerLease.data ?? null} />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Service schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {schedules.isLoading ? (
            <Skeleton className="h-40 w-full" data-testid="schedules-loading" />
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="schedules-empty">
              No schedules configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Service</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((schedule) => (
                  <TableRow key={schedule.id} data-testid={`schedule-row-${schedule.id}`}>
                    <TableCell>
                      <div className="font-medium" data-testid={`schedule-name-${schedule.id}`}>
                        {schedule.name}
                      </div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {schedule.cronExpression}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/services/${schedule.serviceId}`}
                        className="underline-offset-2 hover:underline"
                        data-testid={`schedule-service-link-${schedule.id}`}
                      >
                        {schedule.serviceName}
                      </Link>
                      <div className="text-xs text-muted-foreground">
                        {schedule.projectName} / {schedule.environmentName}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant={schedule.status === "active" ? "default" : "outline"}>
                        {schedule.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {schedule.nextRunAt ? new Date(schedule.nextRunAt).toLocaleString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          data-testid={`schedule-run-${schedule.id}`}
                          onClick={() => void mutateSchedule(schedule.id, "run")}
                        >
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`schedule-toggle-${schedule.id}`}
                          onClick={() =>
                            void mutateSchedule(
                              schedule.id,
                              schedule.status === "active" ? "pause" : "resume"
                            )
                          }
                        >
                          {schedule.status === "active" ? "Pause" : "Resume"}
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          data-testid={`schedule-delete-${schedule.id}`}
                          onClick={() => void mutateSchedule(schedule.id, "delete")}
                        >
                          Delete
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
