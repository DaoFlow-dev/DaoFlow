import { formatBytes } from "../../lib/tone-utils";

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
    <section className="persistent-volumes">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Stateful services</p>
        <h2>Persistent volume registry</h2>
      </div>

      {session.data && persistentVolumes.data ? (
        <>
          <div className="persistent-volume-summary" data-testid="persistent-volume-summary">
            <div className="token-summary__item">
              <span className="metric__label">Volumes</span>
              <strong>{persistentVolumes.data.summary.totalVolumes}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Protected</span>
              <strong>{persistentVolumes.data.summary.protectedVolumes}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Needs attention</span>
              <strong>{persistentVolumes.data.summary.attentionVolumes}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Attached bytes</span>
              <strong>{formatBytes(persistentVolumes.data.summary.attachedBytes)}</strong>
            </div>
          </div>

          <div className="persistent-volume-list">
            {persistentVolumes.data.volumes.map((volume) => (
              <article
                className="token-card"
                data-testid={`persistent-volume-card-${volume.id}`}
                key={volume.id}
              >
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {volume.environmentName} · {volume.projectName}
                    </p>
                    <h3>{volume.volumeName}</h3>
                  </div>
                  <span className={`deployment-status deployment-status--${volume.statusTone}`}>
                    {volume.backupCoverage}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {volume.serviceName} on {volume.targetServerName} ·{" "}
                  {formatBytes(volume.sizeBytes)}
                </p>
                <p className="deployment-card__meta">
                  Mount path: {volume.mountPath} · Driver: {volume.driver}
                </p>
                <p className="deployment-card__meta">
                  Backup policy: {volume.backupPolicyId ?? "Unmanaged"} · Restore readiness:{" "}
                  {volume.restoreReadiness}
                </p>
                <p className="deployment-card__meta">
                  Last backup: {volume.lastBackupAt ?? "No snapshot recorded"} · Last restore test:{" "}
                  {volume.lastRestoreTestAt ?? "Not exercised"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {persistentVolumesMessage ??
            "Sign in to inspect mounted volumes, backup coverage, and restore readiness."}
        </p>
      )}
    </section>
  );
}
