import {
  getManagedDatabaseDefinition,
  managedDatabaseDefinitions,
  type ManagedDatabaseKind
} from "@daoflow/shared";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

interface ManagedDatabaseFieldsProps {
  kind: ManagedDatabaseKind;
  databaseName: string;
  username: string;
  password: string;
  port: string;
  onKindChange: (kind: ManagedDatabaseKind) => void;
  onDatabaseNameChange: (value: string) => void;
  onUsernameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPortChange: (value: string) => void;
}

export function ManagedDatabaseFields({
  kind,
  databaseName,
  username,
  password,
  port,
  onKindChange,
  onDatabaseNameChange,
  onUsernameChange,
  onPasswordChange,
  onPortChange
}: ManagedDatabaseFieldsProps) {
  const definition = getManagedDatabaseDefinition(kind) ?? managedDatabaseDefinitions[0];

  return (
    <div className="space-y-4" data-testid="managed-database-fields">
      <div>
        <Label htmlFor="managed-db-kind">Database</Label>
        <select
          id="managed-db-kind"
          className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          value={kind}
          onChange={(event) => onKindChange(event.target.value as ManagedDatabaseKind)}
          data-testid="managed-database-kind"
        >
          {managedDatabaseDefinitions.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </select>
      </div>

      {definition.databaseField ? (
        <div>
          <Label htmlFor="managed-db-name">Database name</Label>
          <Input
            id="managed-db-name"
            value={databaseName}
            onChange={(event) => onDatabaseNameChange(event.target.value)}
            placeholder={definition.defaultDatabaseName ?? "app"}
            data-testid="managed-database-name"
          />
        </div>
      ) : null}

      {definition.usernameField ? (
        <div>
          <Label htmlFor="managed-db-username">User</Label>
          <Input
            id="managed-db-username"
            value={username}
            onChange={(event) => onUsernameChange(event.target.value)}
            placeholder={definition.defaultUsername ?? "app"}
            data-testid="managed-database-username"
          />
        </div>
      ) : null}

      <div>
        <Label htmlFor="managed-db-password">Password</Label>
        <Input
          id="managed-db-password"
          type="password"
          value={password}
          onChange={(event) => onPasswordChange(event.target.value)}
          placeholder="Auto-generate if blank"
          data-testid="managed-database-password"
        />
      </div>

      <div>
        <Label htmlFor="managed-db-port">Published port</Label>
        <Input
          id="managed-db-port"
          value={port}
          onChange={(event) => onPortChange(event.target.value)}
          placeholder={definition.defaultPort}
          data-testid="managed-database-port"
        />
      </div>
    </div>
  );
}
