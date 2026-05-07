import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

interface SchedulesTabProps {
  serviceId: string;
  serviceName: string;
}

function messageFromError(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

export default function SchedulesTab({ serviceId, serviceName }: SchedulesTabProps) {
  const utils = trpc.useUtils();
  const session = useSession();
  const schedules = trpc.serviceSchedules.useQuery(
    { serviceId },
    { enabled: Boolean(session.data && serviceId), refetchInterval: 10_000 }
  );
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const rows = schedules.data ?? [];
  const selected = rows.find((row) => row.id === selectedScheduleId) ?? rows[0] ?? null;
  const selectedId = selected?.id ?? null;
  const runs = trpc.serviceScheduleRuns.useQuery(
    { scheduleId: selectedId ?? "", limit: 20 },
    { enabled: Boolean(session.data && selectedId), refetchInterval: 5_000 }
  );
  const createSchedule = trpc.createServiceSchedule.useMutation();
  const setScheduleState = trpc.setServiceScheduleState.useMutation();
  const deleteSchedule = trpc.deleteServiceSchedule.useMutation();
  const runScheduleNow = trpc.runServiceScheduleNow.useMutation();
  const [form, setForm] = useState({
    name: "Health check",
    command: "bun run healthcheck",
    cronExpression: "*/15 * * * *",
    timezone: "UTC"
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refreshOperationalViews(scheduleId = selectedId) {
    await Promise.all([
      utils.serviceSchedules.invalidate({ serviceId }),
      utils.serviceSchedules.invalidate({ limit: 100 }),
      scheduleId ? utils.serviceScheduleRuns.invalidate({ scheduleId }) : Promise.resolve()
    ]);
  }

  async function handleCreate() {
    setFeedback(null);
    try {
      const created = await createSchedule.mutateAsync({ serviceId, ...form });
      setSelectedScheduleId(created.id);
      await refreshOperationalViews(created.id);
      setFeedback(`Created schedule ${created.name}.`);
    } catch (error) {
      setFeedback(messageFromError(error, "Unable to create the schedule."));
    }
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
      await refreshOperationalViews(scheduleId);
      setFeedback(`${action[0]?.toUpperCase()}${action.slice(1)} completed.`);
    } catch (error) {
      setFeedback(messageFromError(error, `Unable to ${action} the schedule.`));
    }
  }

  if (schedules.isLoading) {
    return <Skeleton className="h-40 w-full" data-testid="service-schedules-loading" />;
  }

  return (
    <div className="space-y-4" data-testid="service-schedules-tab">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">New schedule for {serviceName}</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-5">
          {(["name", "command", "cronExpression", "timezone"] as const).map((key) => (
            <div className="space-y-1" key={key}>
              <Label htmlFor={`schedule-${key}`}>{key === "cronExpression" ? "Cron" : key}</Label>
              <Input
                id={`schedule-${key}`}
                value={form[key]}
                data-testid={`service-schedule-${key}`}
                onChange={(event) =>
                  setForm((current) => ({ ...current, [key]: event.target.value }))
                }
              />
            </div>
          ))}
          <div className="flex items-end">
            <Button data-testid="service-schedule-create" onClick={() => void handleCreate()}>
              Create
            </Button>
          </div>
        </CardContent>
      </Card>

      {feedback ? (
        <p className="rounded-md border bg-muted px-3 py-2 text-sm" data-testid="schedule-feedback">
          {feedback}
        </p>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Schedules</CardTitle>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="service-schedules-empty">
              No schedules configured.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Cron</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((schedule) => (
                  <TableRow key={schedule.id} data-testid={`service-schedule-row-${schedule.id}`}>
                    <TableCell>
                      <button
                        type="button"
                        className="font-medium underline-offset-2 hover:underline"
                        data-testid={`service-schedule-select-${schedule.id}`}
                        onClick={() => setSelectedScheduleId(schedule.id)}
                      >
                        {schedule.name}
                      </button>
                      <div className="text-xs text-muted-foreground">{schedule.command}</div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{schedule.cronExpression}</TableCell>
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
                          data-testid={`service-schedule-run-${schedule.id}`}
                          onClick={() => void mutateSchedule(schedule.id, "run")}
                        >
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          data-testid={`service-schedule-toggle-${schedule.id}`}
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
                          data-testid={`service-schedule-delete-${schedule.id}`}
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

      {selected ? (
        <Card data-testid="service-schedule-runs">
          <CardHeader>
            <CardTitle className="text-base">Run history: {selected.name}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {(runs.data?.runs ?? []).map((run) => (
              <div
                key={run.id}
                className="rounded-md border p-3"
                data-testid={`schedule-run-${run.id}`}
              >
                <div className="flex items-center justify-between gap-3">
                  <Badge variant={run.status === "succeeded" ? "default" : "outline"}>
                    {run.status}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {new Date(run.createdAt).toLocaleString()}
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                  {run.logs}
                </pre>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
