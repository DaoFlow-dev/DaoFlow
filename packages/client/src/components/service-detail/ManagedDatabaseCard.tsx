import { Database } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface ManagedDatabaseCardProps {
  serviceId: string;
  database: {
    kind: string;
    label: string;
    databaseName: string | null;
    username: string | null;
    port: string;
    internalPort: string;
    serviceName: string;
    volumeName: string;
    backupPolicyId?: string | null;
    backupType?: "database" | "volume";
    backupEngine?: string | null;
    connectionUriMasked: string;
    internalConnectionUriMasked: string;
  };
}

export function ManagedDatabaseCard({ serviceId, database }: ManagedDatabaseCardProps) {
  return (
    <Card className="shadow-sm" data-testid={`managed-database-card-${serviceId}`}>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Database size={14} />
          Managed Database
        </CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-1 md:grid-cols-2 gap-x-6 gap-y-4 text-sm">
          <Item
            label="Engine"
            value={database.label}
            testId={`managed-database-kind-${serviceId}`}
          />
          {database.databaseName ? (
            <Item
              label="Database"
              value={database.databaseName}
              testId={`managed-database-name-${serviceId}`}
            />
          ) : null}
          {database.username ? (
            <Item
              label="User"
              value={database.username}
              testId={`managed-database-user-${serviceId}`}
            />
          ) : null}
          <Item label="Port" value={database.port} testId={`managed-database-port-${serviceId}`} />
          <Item
            label="Volume"
            value={database.volumeName}
            mono
            testId={`managed-database-volume-${serviceId}`}
          />
          {database.backupPolicyId ? (
            <Item
              label="Backup policy"
              value={
                database.backupEngine
                  ? `${database.backupEngine} dumps enabled`
                  : "Volume snapshots enabled"
              }
              testId={`managed-database-backup-${serviceId}`}
            />
          ) : null}
          <Item
            label="Internal URI"
            value={database.internalConnectionUriMasked}
            mono
            testId={`managed-database-internal-uri-${serviceId}`}
          />
          <Item
            label="Published URI"
            value={database.connectionUriMasked}
            mono
            testId={`managed-database-public-uri-${serviceId}`}
          />
        </dl>
      </CardContent>
    </Card>
  );
}

function Item({
  label,
  value,
  mono,
  testId
}: {
  label: string;
  value: string;
  mono?: boolean;
  testId: string;
}) {
  return (
    <div data-testid={testId}>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "font-mono text-xs mt-0.5 break-all" : "font-medium mt-0.5"}>
        {value}
      </dd>
    </div>
  );
}
