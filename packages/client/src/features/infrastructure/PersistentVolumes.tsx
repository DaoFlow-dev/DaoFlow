import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { formatBytes, getBadgeVariantFromTone } from "@/lib/tone-utils";

interface VolumeItem {
  id: string;
  volumeName: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetServerName: string;
  sizeBytes: number;
  mountPath: string;
  driver: string;
  backupCoverage: string;
  restoreReadiness: string;
  statusTone: string;
  backupPolicyId: string | null;
  lastBackupAt: string | null;
  lastRestoreTestAt: string | null;
}

interface PersistentVolumeData {
  summary: {
    totalVolumes: number;
    protectedVolumes: number;
    attentionVolumes: number;
    attachedBytes: number;
  };
  volumes: VolumeItem[];
}

export interface PersistentVolumesProps {
  session: { data: unknown };
  persistentVolumes: { data?: PersistentVolumeData };
  persistentVolumesMessage: string | null;
}

export function PersistentVolumes({
  session,
  persistentVolumes,
  persistentVolumesMessage
}: PersistentVolumesProps) {
  return (
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Stateful services
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Persistent volume registry
        </h2>
      </div>

      {session.data && persistentVolumes.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="persistent-volume-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Volumes
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {persistentVolumes.data.summary.totalVolumes}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Protected
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {persistentVolumes.data.summary.protectedVolumes}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Needs attention
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {persistentVolumes.data.summary.attentionVolumes}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Attached bytes
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {formatBytes(persistentVolumes.data.summary.attachedBytes)}
              </strong>
            </Card>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {persistentVolumes.data.volumes.map((volume) => (
              <article
                className="rounded-xl border bg-card p-5 shadow-sm"
                data-testid={`persistent-volume-card-${volume.id}`}
                key={volume.id}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {volume.environmentName} · {volume.projectName}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{volume.volumeName}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(volume.statusTone)}>
                    {volume.backupCoverage}
                  </Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {volume.serviceName} on {volume.targetServerName} ·{" "}
                  {formatBytes(volume.sizeBytes)}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Mount path: {volume.mountPath} · Driver: {volume.driver}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Backup policy: {volume.backupPolicyId ?? "Unmanaged"} · Restore readiness:{" "}
                  {volume.restoreReadiness}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Last backup: {volume.lastBackupAt ?? "No snapshot recorded"} · Last restore test:{" "}
                  {volume.lastRestoreTestAt ?? "Not exercised"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {persistentVolumesMessage ??
            "Sign in to inspect mounted volumes, backup coverage, and restore readiness."}
        </p>
      )}
    </section>
  );
}
