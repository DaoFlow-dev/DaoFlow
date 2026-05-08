import { useState, type ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Check,
  Copy,
  CircleAlert,
  ExternalLink,
  FileText,
  GitPullRequest,
  MonitorUp,
  Terminal
} from "lucide-react";

interface ReviewRun {
  pullRequestUrl?: string | null;
  previewUrl?: string | null;
  metadata?: unknown;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function extractReviewArtifacts(metadata: unknown) {
  const root = asRecord(metadata);
  const reviewRequest = asRecord(root?.pullRequest) ?? asRecord(root?.mergeRequest);
  const artifacts = asRecord(reviewRequest?.reviewArtifacts);
  const diffStatPath = artifacts?.diffStatPath;
  const changedFilesPath = artifacts?.changedFilesPath;

  return {
    diffStatPath: typeof diffStatPath === "string" ? diffStatPath : null,
    changedFilesPath: typeof changedFilesPath === "string" ? changedFilesPath : null
  };
}

function extractLogPaths(metadata: unknown) {
  const root = asRecord(metadata);
  const codexExecution = asRecord(root?.codexExecution);
  const validation = asRecord(root?.validation);
  const reviewRequest = asRecord(root?.pullRequest) ?? asRecord(root?.mergeRequest);
  const candidates: Array<{ label: string; value: unknown }> = [
    { label: "Codex log", value: codexExecution?.logPath },
    { label: "Validation log", value: validation?.logPath },
    { label: "Review handoff log", value: reviewRequest?.logPath }
  ];

  return candidates
    .map(({ label, value }) => ({
      label,
      path: typeof value === "string" ? value : null
    }))
    .filter((entry): entry is { label: string; path: string } => Boolean(entry.path));
}

export function DevelopmentTaskReviewOutputs({ latestRun }: { latestRun?: ReviewRun }) {
  const [copyState, setCopyState] = useState<{
    path: string;
    status: "copied" | "failed";
  } | null>(null);
  const artifacts = extractReviewArtifacts(latestRun?.metadata);
  const diffStatPath = artifacts.diffStatPath;
  const changedFilesPath = artifacts.changedFilesPath;
  const logs = extractLogPaths(latestRun?.metadata);
  const hasArtifacts = Boolean(diffStatPath || changedFilesPath);
  const hasLogs = logs.length > 0;

  function copyPath(path: string) {
    const clipboard = navigator.clipboard;

    if (!clipboard) {
      setCopyState({ path, status: "failed" });
      window.setTimeout(
        () => setCopyState((current) => (current?.path === path ? null : current)),
        1500
      );
      return;
    }

    void clipboard
      .writeText(path)
      .then(() => setCopyState({ path, status: "copied" }))
      .catch(() => setCopyState({ path, status: "failed" }))
      .finally(() => {
        window.setTimeout(
          () => setCopyState((current) => (current?.path === path ? null : current)),
          1500
        );
      });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm">Review Outputs</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <div className="space-y-2">
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
        </div>

        {hasArtifacts || hasLogs ? (
          <div className="space-y-2 border-t pt-3">
            {diffStatPath ? (
              <ReviewPathRow
                icon={<FileText size={13} />}
                label="Diff stat"
                path={diffStatPath}
                copyStatus={copyState?.path === diffStatPath ? copyState.status : null}
                onCopy={() => copyPath(diffStatPath)}
              />
            ) : null}
            {changedFilesPath ? (
              <ReviewPathRow
                icon={<ExternalLink size={13} />}
                label="Changed files"
                path={changedFilesPath}
                copyStatus={copyState?.path === changedFilesPath ? copyState.status : null}
                onCopy={() => copyPath(changedFilesPath)}
              />
            ) : null}
            {logs.map((log) => (
              <ReviewPathRow
                key={log.label}
                icon={<Terminal size={13} />}
                label={log.label}
                path={log.path}
                copyStatus={copyState?.path === log.path ? copyState.status : null}
                onCopy={() => copyPath(log.path)}
              />
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No review artifacts or logs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}

function ReviewPathRow({
  icon,
  label,
  path,
  copyStatus,
  onCopy
}: {
  icon: ReactNode;
  label: string;
  path: string;
  copyStatus: "copied" | "failed" | null;
  onCopy: () => void;
}) {
  const failed = copyStatus === "failed";
  const copied = copyStatus === "copied";

  return (
    <div className="flex items-start justify-between gap-2 rounded-md border bg-muted/30 p-2">
      <div className="min-w-0 text-xs text-muted-foreground">
        <p className="mb-1 flex items-center gap-1 font-medium text-foreground">
          {icon}
          {label}
        </p>
        <p className="break-all font-mono">{path}</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-7 shrink-0 gap-1 px-2 text-xs"
        onClick={onCopy}
        data-testid={`development-task-copy-${label.toLowerCase().replaceAll(" ", "-")}`}
      >
        {copied ? <Check size={13} /> : failed ? <CircleAlert size={13} /> : <Copy size={13} />}
        {copied ? "Copied" : failed ? "Retry" : "Copy"}
      </Button>
    </div>
  );
}
