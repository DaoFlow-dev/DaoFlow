import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, FileText, GitPullRequest, MonitorUp, Terminal } from "lucide-react";

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
    .filter((entry) => entry.path);
}

export function DevelopmentTaskReviewOutputs({ latestRun }: { latestRun?: ReviewRun }) {
  const artifacts = extractReviewArtifacts(latestRun?.metadata);
  const logs = extractLogPaths(latestRun?.metadata);
  const hasArtifacts = Boolean(artifacts.diffStatPath || artifacts.changedFilesPath);
  const hasLogs = logs.length > 0;

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
            {artifacts.diffStatPath ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                <FileText size={13} className="mr-1 inline" />
                {artifacts.diffStatPath}
              </p>
            ) : null}
            {artifacts.changedFilesPath ? (
              <p className="break-all font-mono text-xs text-muted-foreground">
                <ExternalLink size={13} className="mr-1 inline" />
                {artifacts.changedFilesPath}
              </p>
            ) : null}
            {logs.map((log) => (
              <p key={log.label} className="break-all font-mono text-xs text-muted-foreground">
                <Terminal size={13} className="mr-1 inline" />
                {log.label}: {log.path}
              </p>
            ))}
          </div>
        ) : (
          <p className="text-muted-foreground">No review artifacts or logs yet.</p>
        )}
      </CardContent>
    </Card>
  );
}
