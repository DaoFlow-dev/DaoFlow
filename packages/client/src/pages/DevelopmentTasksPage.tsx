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
import { SandboxRunnerCard } from "@/components/SandboxRunnerCard";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { getInventoryBadgeVariant } from "@/lib/tone-utils";
import { Bot, ExternalLink, RefreshCw } from "lucide-react";

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
          ) : tasks.isError ? (
            <div className="py-12 text-center text-sm text-destructive">
              Unable to load development tasks.
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
              {runnerProfiles.data?.map((profile) => (
                <SandboxRunnerCard key={profile.id} profile={profile} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
