import { randomBytes } from "node:crypto";
import {
  getManagedDatabaseDefinition,
  type ManagedDatabaseKind,
  type ManagedDatabaseDefinition
} from "@daoflow/shared";
import type { DatabaseEngine } from "./storage-management-shared";

export function secret(length = 24): string {
  return randomBytes(length).toString("base64url");
}

export function cleanName(value: string | undefined, fallback: string): string {
  const cleaned = (value ?? fallback)
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");
  return cleaned.slice(0, 63) || fallback;
}

export function maskConnection(input: {
  scheme: string;
  user: string | null;
  host: string;
  port: string;
  database: string | null;
}) {
  if (input.scheme === "redis") {
    return `redis://:[secret]@${input.host}:${input.port}/0`;
  }

  const auth = input.user ? `${encodeURIComponent(input.user)}:[secret]@` : "";
  const path = input.database ? `/${encodeURIComponent(input.database)}` : "";
  const query = input.scheme === "mongodb" ? "?authSource=admin" : "";
  return `${input.scheme}://${auth}${input.host}:${input.port}${path}${query}`;
}

export function buildTemplateValues(input: {
  kind: ManagedDatabaseKind;
  databaseName: string | null;
  username: string | null;
  password: string;
  rootPassword: string;
  port: string;
}) {
  const definition = getManagedDatabaseDefinition(input.kind);
  if (!definition) throw new Error(`Unsupported managed database kind "${input.kind}".`);

  const values: Record<string, string> = {
    [definition.passwordField]: input.password,
    [definition.portField]: input.port
  };
  if (definition.databaseField && input.databaseName) {
    values[definition.databaseField] = input.databaseName;
  }
  if (definition.usernameField && input.username) {
    values[definition.usernameField] = input.username;
  }
  if (definition.rootPasswordField) {
    values[definition.rootPasswordField] = input.rootPassword;
  }
  return values;
}

export function backupEngineForKind(kind: ManagedDatabaseKind): DatabaseEngine | null {
  if (kind === "redis") return null;
  return kind;
}

export function buildManagedDatabaseMetadata(input: {
  definition: ManagedDatabaseDefinition;
  databaseName: string | null;
  username: string | null;
  port: string;
  stackName: string;
}) {
  const base = {
    kind: input.definition.kind,
    label: input.definition.label,
    templateSlug: input.definition.templateSlug,
    databaseName: input.databaseName,
    username: input.username,
    port: input.port,
    internalPort: input.definition.internalPort,
    serviceName: input.definition.serviceName,
    volumeName: `${input.stackName}-${input.definition.serviceName}-data`
  };
  return {
    ...base,
    connectionUriMasked: maskConnection({
      scheme: input.definition.connectionScheme,
      user: input.username,
      host: "localhost",
      port: input.port,
      database: input.databaseName
    }),
    internalConnectionUriMasked: maskConnection({
      scheme: input.definition.connectionScheme,
      user: input.username,
      host: input.definition.serviceName,
      port: input.definition.internalPort,
      database: input.databaseName
    })
  };
}
