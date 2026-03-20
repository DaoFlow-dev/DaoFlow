import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface AuditEntry {
  id: string;
  actorLabel: string;
  actorType: string;
  actorRole: string | null;
  action: string;
  resourceType: string;
  resourceLabel: string;
  statusTone: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Auditability before convenience
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Immutable control-plane audit trail
        </h2>
      </div>

      {session.data && auditTrail.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="audit-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Entries
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {auditTrail.data.summary.totalEntries}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Deploy
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {auditTrail.data.summary.deploymentActions}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Execution
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {auditTrail.data.summary.executionActions}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Backup
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {auditTrail.data.summary.backupActions}
              </strong>
            </Card>
          </div>

          <div className="space-y-3">
            {auditTrail.data.entries.map((entry) => (
              <Card className="p-5" data-testid={`audit-entry-${entry.id}`} key={entry.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {entry.actorLabel}
                      {entry.actorRole ? ` · ${entry.actorRole}` : ` · ${entry.actorType}`}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{entry.action}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(entry.statusTone)}>
                    {entry.resourceType}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{entry.resourceLabel}</p>
                <p className="mt-2 text-sm text-muted-foreground">{entry.detail}</p>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {auditMessage ?? "Sign in to inspect immutable control-plane audit entries."}
        </p>
      )}
    </section>
  );
}
