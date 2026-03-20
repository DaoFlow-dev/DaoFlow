import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getLogTone, getBadgeVariantFromTone } from "@/lib/tone-utils";

interface LogLine {
  id: string | number;
  serviceName: string;
  environmentName: string;
  stream: "stdout" | "stderr";
  lineNumber: string | number;
  message: string;
}

interface DeploymentLogsData {
  summary: {
    totalLines: number;
    stderrLines: number;
    deploymentCount: number;
  };
  lines: LogLine[];
}

export interface DeploymentLogsProps {
  session: { data: unknown };
  deploymentLogs: { data?: DeploymentLogsData };
  logsMessage: string | null;
}

export function DeploymentLogs({ session, deploymentLogs, logsMessage }: DeploymentLogsProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Raw evidence
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Append-only deployment logs
        </h2>
      </div>

      {session.data && deploymentLogs.data ? (
        <>
          <div className="grid grid-cols-3 gap-3 mb-3" data-testid="log-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Lines
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {deploymentLogs.data.summary.totalLines}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                stderr
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {deploymentLogs.data.summary.stderrLines}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Deployments
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {deploymentLogs.data.summary.deploymentCount}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {deploymentLogs.data.lines.map((line) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`deployment-log-line-${line.id}`}
                key={line.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {line.serviceName} · {line.environmentName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">
                      {line.stream} #{line.lineNumber}
                    </h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(getLogTone(line.stream))}>
                    {line.stream}
                  </Badge>
                </div>
                <p className="mt-2 font-mono text-sm text-muted-foreground">{line.message}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {logsMessage ?? "Sign in to inspect append-only deployment log lines."}
        </p>
      )}
    </section>
  );
}
