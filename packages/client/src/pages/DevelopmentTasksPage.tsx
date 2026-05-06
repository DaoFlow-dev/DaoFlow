import { useState } from "react";
import { Link } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { buttonVariants } from "@/components/ui/button-variants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import { Bot, Cpu, ExternalLink, HardDrive, MemoryStick, RefreshCw } from "lucide-react";

const TASK_STATUSES = [
  "queued",
  "running",
  "waiting_review",
  "blocked",
  "failed",
  "canceled",
  "completed"
] as const;

type TaskStatusFilter = "all" | (typeof TASK_STATUSES)[number];

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

function formatLabel(value: string | null | undefined) {
  return value?.replaceAll("_", " ") ?? "unassigned";
}

function readStringList(value: unknown) {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

export default function DevelopmentTasksPage() {
  const [statusFilter, setStatusFilter] = useState<TaskStatusFilter>("all");
  const tasks = trpc.developmentTasks.useQuery({
    limit: 50,
    ...(statusFilter === "all" ? {} : { status: statusFilter })
  });
  const runnerProfiles = trpc.sandboxRunnerProfiles.useQuery({ limit: 10 });

  return (
    <main className="shell space-y-6" data-testid="development-tasks-page">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
            <Bot size={24} /> Development Tasks
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Issue-triggered agent work queued for human review.
          </p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Select
            value={statusFilter}
            onValueChange={(value) => setStatusFilter(value as TaskStatusFilter)}
          >
            <SelectTrigger className="w-[160px]" aria-label="Task status filter">
              <SelectValue placeholder="Task status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All tasks</SelectItem>
              {TASK_STATUSES.map((status) => (
                <SelectItem key={status} value={status}>
                  {status}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button variant="outline" size="sm" onClick={() => void tasks.refetch()}>
            <RefreshCw size={14} className="mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Task Queue</CardTitle>
        </CardHeader>
        <CardContent>
          {tasks.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : tasks.data?.length === 0 ? (
            <div className="py-12 text-center text-sm text-muted-foreground">
              No development tasks have been queued.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Issue</TableHead>
                  <TableHead>Repository</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested By</TableHead>
                  <TableHead>Created</TableHead>
                  <TableHead className="text-right">Action</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tasks.data?.map((task) => (
                  <TableRow key={task.id}>
                    <TableCell>
                      <div className="space-y-1">
                        <Link
                          to={`/development-tasks/${task.id}`}
                          className="font-medium hover:underline"
                        >
                          #{task.issueNumber} {task.issueTitle}
                        </Link>
                        <a
                          href={task.issueUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                        >
                          Open issue <ExternalLink size={12} />
                        </a>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{task.repoFullName}</TableCell>
                    <TableCell>
                      <Badge variant={getInventoryBadgeVariant(task.status)}>{task.status}</Badge>
                    </TableCell>
                    <TableCell>
                      {task.requestedByExternalUser ?? task.issueAuthor ?? "system"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(task.createdAt)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        to={`/development-tasks/${task.id}`}
                        className={buttonVariants({ variant: "outline", size: "sm" })}
                      >
                        View
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Sandbox Runners</CardTitle>
        </CardHeader>
        <CardContent>
          {runnerProfiles.isLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-20 w-full" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : runnerProfiles.isError ? (
            <div className="py-8 text-center text-sm text-destructive">
              Unable to load sandbox runner profiles.
            </div>
          ) : runnerProfiles.data?.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              No sandbox runner profiles are configured.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2">
              {runnerProfiles.data?.map((profile) => {
                const commands = readStringList(profile.validationCommands);
                return (
                  <div key={profile.id} className="min-w-0 rounded-md border p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{profile.name}</p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          {formatLabel(profile.provider)} · {formatLabel(profile.codexAuthMode)}
                        </p>
                      </div>
                      <Badge variant={getInventoryBadgeVariant(profile.status)}>
                        {profile.status}
                      </Badge>
                    </div>
                    <div className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                      <span className="inline-flex items-center gap-1">
                        <Cpu size={12} /> {profile.cpuLimit} CPU
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <MemoryStick size={12} /> {profile.memoryLimitMb} MB
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <HardDrive size={12} /> {profile.diskLimitMb} MB
                      </span>
                    </div>
                    <p className="mt-2 break-all text-xs text-muted-foreground">
                      Image: <span className="font-mono">{profile.image}</span>
                    </p>
                    <p className="mt-1 break-words text-xs text-muted-foreground">
                      Validation: {commands.length > 0 ? commands.join(", ") : "not configured"}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
