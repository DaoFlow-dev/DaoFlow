import { getLogTone } from "../../lib/tone-utils";

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
    <section className="deployment-logs">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Raw evidence</p>
        <h2>Append-only deployment logs</h2>
      </div>

      {session.data && deploymentLogs.data ? (
        <>
          <div className="log-summary" data-testid="log-summary">
            <div className="token-summary__item">
              <span className="metric__label">Lines</span>
              <strong>{deploymentLogs.data.summary.totalLines}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">stderr</span>
              <strong>{deploymentLogs.data.summary.stderrLines}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Deployments</span>
              <strong>{deploymentLogs.data.summary.deploymentCount}</strong>
            </div>
          </div>

          <div className="log-list">
            {deploymentLogs.data.lines.map((line) => (
              <article
                className="token-card log-line"
                data-testid={`deployment-log-line-${line.id}`}
                key={line.id}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {line.serviceName} · {line.environmentName}
                    </p>
                    <h3>
                      {line.stream} #{line.lineNumber}
                    </h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${getLogTone(line.stream)}`}
                  >
                    {line.stream}
                  </span>
                </div>
                <p className="deployment-card__meta log-line__message">{line.message}</p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {logsMessage ?? "Sign in to inspect append-only deployment log lines."}
        </p>
      )}
    </section>
  );
}
