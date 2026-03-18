import { getAuditTone } from "../../lib/tone-utils";

interface AuditEntry {
  id: string;
  actorLabel: string;
  actorType: string;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceLabel: string;
  statusTone?: string;
  detail: string;
}

interface AuditTrailData {
  summary: {
    totalEntries: number;
    deploymentActions: number;
    executionActions: number;
    backupActions: number;
  };
  entries: AuditEntry[];
}

export interface AuditTrailProps {
  session: { data: unknown };
  auditTrail: { data?: AuditTrailData };
  auditMessage: string | null;
}

export function AuditTrail({ session, auditTrail, auditMessage }: AuditTrailProps) {
  return (
    <section className="audit-trail">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Auditability before convenience</p>
        <h2>Immutable control-plane audit trail</h2>
      </div>

      {session.data && auditTrail.data ? (
        <>
          <div className="audit-summary" data-testid="audit-summary">
            <div className="token-summary__item">
              <span className="metric__label">Entries</span>
              <strong>{auditTrail.data.summary.totalEntries}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Deploy</span>
              <strong>{auditTrail.data.summary.deploymentActions}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Execution</span>
              <strong>{auditTrail.data.summary.executionActions}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Backup</span>
              <strong>{auditTrail.data.summary.backupActions}</strong>
            </div>
          </div>

          <div className="audit-list">
            {auditTrail.data.entries.map((entry) => {
              const statusTone = entry.statusTone ?? getAuditTone(entry.action);

              return (
                <article
                  className="timeline-event"
                  data-testid={`audit-entry-${entry.id}`}
                  key={entry.id}
                >
                  <div className="timeline-event__top">
                    <div>
                      <p className="roadmap-item__lane">
                        {entry.actorLabel}
                        {entry.actorRole ? ` · ${entry.actorRole}` : ` · ${entry.actorType}`}
                      </p>
                      <h3>{entry.action}</h3>
                    </div>
                    <span className={`deployment-status deployment-status--${statusTone}`}>
                      {entry.resourceType}
                    </span>
                  </div>
                  <p className="deployment-card__meta">{entry.resourceLabel}</p>
                  <p className="deployment-card__meta">{entry.detail}</p>
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {auditMessage ?? "Sign in to inspect immutable control-plane audit entries."}
        </p>
      )}
    </section>
  );
}
