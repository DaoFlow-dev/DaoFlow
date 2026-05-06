import { useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Link, useParams } from "react-router-dom";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  ArrowLeft,
  ExternalLink,
  GitPullRequest,
  MonitorUp,
  RotateCcw,
  XCircle
} from "lucide-react";

const CANCELABLE_STATUSES = new Set(["queued", "running", "waiting_review", "blocked"]);
const RETRYABLE_STATUSES = new Set(["failed", "canceled", "blocked"]);

function formatDate(value: string | Date) {
  return new Date(value).toLocaleString();
}

export default function DevelopmentTaskDetailPage() {
  const { id } = useParams();
  const [feedback, setFeedback] = useState<string | null>(null);
  const task = trpc.developmentTaskDetails.useQuery({ taskId: id ?? "" }, { enabled: Boolean(id) });
  const cancelTask = trpc.cancelDevelopmentTask.useMutation();
  const retryTask = trpc.retryDevelopmentTask.useMutation();
  const actionPending = cancelTask.isPending || retryTask.isPending;

  async function handleCancel() {
    if (!id) return;
    setFeedback(null);
    try {
      await cancelTask.mutateAsync({ taskId: id });
      await task.refetch();
      setFeedback("Development task canceled.");
    } catch (error) {
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to cancel the task.");
    }
  }

  async function handleRetry() {
    if (!id) return;
    setFeedback(null);
    try {
      await retryTask.mutateAsync({ taskId: id });
      await task.refetch();
      setFeedback("Development task retry queued.");
    } catch (error) {
      setFeedback(isTRPCClientError(error) ? error.message : "Unable to retry the task.");
    }
  }

  if (task.isLoading) {
    return (
      <main className="shell space-y-6">
        <Skeleton className="h-8 w-72" />
        <Skeleton className="h-48 w-full" />
      </main>
    );
  }

  if (!task.data) {
    return (
      <main className="shell space-y-6">
        <Link
          to="/development-tasks"
          className={buttonVariants({ variant: "outline", size: "sm" })}
        >
          <ArrowLeft size={14} className="mr-2" />
          Back
        </Link>
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            Development task not found.
          </CardContent>
        </Card>
      </main>
    );
  }

  const { task: details, runs, events, comments } = task.data;
  const latestRun = runs[0];
  const canCancel = CANCELABLE_STATUSES.has(details.status);
  const canRetry = RETRYABLE_STATUSES.has(details.status);

  return (
    <main className="shell space-y-6" data-testid="development-task-detail-page">
      <div className="flex items-start justify-between gap-4">
        <div className="space-y-2">
          <Link
            to="/development-tasks"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <ArrowLeft size={14} className="mr-2" />
            Back
          </Link>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">
              #{details.issueNumber} {details.issueTitle}
            </h1>
            <p className="mt-1 font-mono text-sm text-muted-foreground">{details.repoFullName}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Badge variant={getInventoryBadgeVariant(details.status)}>{details.status}</Badge>
          <Button
            variant="outline"
            size="sm"
            disabled={!canCancel || actionPending}
            onClick={() => void handleCancel()}
          >
            <XCircle size={14} className="mr-2" />
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={!canRetry || actionPending}
            onClick={() => void handleRetry()}
          >
            <RotateCcw size={14} className="mr-2" />
            Retry
          </Button>
        </div>
      </div>

      {feedback ? (
        <Card>
          <CardContent className="py-3 text-sm text-muted-foreground">{feedback}</CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Issue</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <a
              href={details.issueUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 font-medium hover:underline"
            >
              Open source issue <ExternalLink size={13} />
            </a>
            <p className="text-muted-foreground">Author: {details.issueAuthor ?? "unknown"}</p>
            <p className="text-muted-foreground">
              Requested by: {details.requestedByExternalUser ?? "system"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Latest Run</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestRun ? (
              <>
                <Badge variant={getInventoryBadgeVariant(latestRun.status)}>
                  {latestRun.status}
                </Badge>
                <p className="text-muted-foreground">Runner: {latestRun.runnerId ?? "pending"}</p>
                <p className="text-muted-foreground">
                  Branch: {latestRun.branchName ?? "not created"}
                </p>
              </>
            ) : (
              <p className="text-muted-foreground">No run has claimed this task.</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Review Outputs</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {latestRun?.pullRequestUrl ? (
              <a
                href={latestRun.pullRequestUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                Pull request <GitPullRequest size={13} />
              </a>
            ) : (
              <p className="text-muted-foreground">No pull request yet.</p>
            )}
            {latestRun?.previewUrl ? (
              <a
                href={latestRun.previewUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 font-medium hover:underline"
              >
                Preview <MonitorUp size={13} />
              </a>
            ) : (
              <p className="text-muted-foreground">No preview URL yet.</p>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Time</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Summary</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((event) => (
                <TableRow key={event.id}>
                  <TableCell className="whitespace-nowrap text-muted-foreground">
                    {formatDate(event.createdAt)}
                  </TableCell>
                  <TableCell className="font-mono text-xs">{event.kind}</TableCell>
                  <TableCell>{event.summary}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Issue Comments</CardTitle>
        </CardHeader>
        <CardContent>
          {comments.length === 0 ? (
            <p className="text-sm text-muted-foreground">No tracked comments yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Kind</TableHead>
                  <TableHead>External ID</TableHead>
                  <TableHead>Updated</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {comments.map((comment) => (
                  <TableRow key={comment.id}>
                    <TableCell>{comment.commentKind}</TableCell>
                    <TableCell className="font-mono text-xs">{comment.externalCommentId}</TableCell>
                    <TableCell className="text-muted-foreground">
                      {formatDate(comment.updatedAt)}
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
