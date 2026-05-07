export const managedDatabaseKinds = ["postgres", "mysql", "mariadb", "mongo", "redis"] as const;

export type ManagedDatabaseKind = (typeof managedDatabaseKinds)[number];

export interface ManagedDatabaseDefinition {
  kind: ManagedDatabaseKind;
  label: string;
  templateSlug: string;
  serviceName: string;
  defaultDatabaseName: string | null;
  defaultUsername: string | null;
  defaultPort: string;
  internalPort: string;
  passwordField: string;
  rootPasswordField?: string;
  databaseField?: string;
  usernameField?: string;
  portField: string;
  connectionScheme: string;
  volumeMountPath: string;
}

export const managedDatabaseDefinitions: ManagedDatabaseDefinition[] = [
  {
    kind: "postgres",
    label: "PostgreSQL",
    templateSlug: "postgres",
    serviceName: "postgres",
    defaultDatabaseName: "app",
    defaultUsername: "app",
    defaultPort: "5432",
    internalPort: "5432",
    passwordField: "postgres_password",
    databaseField: "postgres_db",
    usernameField: "postgres_user",
    portField: "postgres_port",
    connectionScheme: "postgresql",
    volumeMountPath: "/var/lib/postgresql/data"
  },
  {
    kind: "mysql",
    label: "MySQL",
    templateSlug: "mysql",
    serviceName: "mysql",
    defaultDatabaseName: "app",
    defaultUsername: "app",
    defaultPort: "3306",
    internalPort: "3306",
    passwordField: "mysql_password",
    rootPasswordField: "mysql_root_password",
    databaseField: "mysql_database",
    usernameField: "mysql_user",
    portField: "mysql_port",
    connectionScheme: "mysql",
    volumeMountPath: "/var/lib/mysql"
  },
  {
    kind: "mariadb",
    label: "MariaDB",
    templateSlug: "mariadb",
    serviceName: "mariadb",
    defaultDatabaseName: "app",
    defaultUsername: "app",
    defaultPort: "3306",
    internalPort: "3306",
    passwordField: "mariadb_password",
    rootPasswordField: "mariadb_root_password",
    databaseField: "mariadb_database",
    usernameField: "mariadb_user",
    portField: "mariadb_port",
    connectionScheme: "mysql",
    volumeMountPath: "/var/lib/mysql"
  },
  {
    kind: "mongo",
    label: "MongoDB",
    templateSlug: "mongo",
    serviceName: "mongo",
    defaultDatabaseName: "app",
    defaultUsername: "root",
    defaultPort: "27017",
    internalPort: "27017",
    passwordField: "mongo_root_password",
    databaseField: "mongo_database",
    usernameField: "mongo_root_user",
    portField: "mongo_port",
    connectionScheme: "mongodb",
    volumeMountPath: "/data/db"
  },
  {
    kind: "redis",
    label: "Redis",
    templateSlug: "redis",
    serviceName: "redis",
    defaultDatabaseName: null,
    defaultUsername: null,
    defaultPort: "6379",
    internalPort: "6379",
    passwordField: "redis_password",
    portField: "redis_port",
    connectionScheme: "redis",
    volumeMountPath: "/data"
  }
];

export function getManagedDatabaseDefinition(kind: string) {
  return managedDatabaseDefinitions.find((definition) => definition.kind === kind);
}

export function isManagedDatabaseKind(value: string): value is ManagedDatabaseKind {
  return managedDatabaseKinds.includes(value as ManagedDatabaseKind);
}
