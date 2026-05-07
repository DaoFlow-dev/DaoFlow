import { readFileSync } from "node:fs";
import chalk from "chalk";

export function readDatabaseSecret(
  input: { value?: string; env?: string; file?: string },
  label: string
) {
  const provided = [input.value, input.env, input.file].filter(Boolean);
  if (provided.length > 1) {
    throw new Error(`${label} can only be supplied by one of value, env, or file.`);
  }
  if (input.value) return input.value;
  if (input.env) {
    const value = process.env[input.env];
    if (!value) throw new Error(`${label} env var ${input.env} is empty or missing.`);
    return value;
  }
  if (input.file) return readFileSync(input.file, "utf8").trim();
  return undefined;
}

export function databaseNotFound(id: string) {
  return `Service ${id} is not a managed database.`;
}

export function renderDatabaseDetails(input: {
  serviceName: string;
  serviceId: string;
  database: {
    label: string;
    databaseName: string | null;
    username: string | null;
    port: string;
    volumeName: string;
    backupPolicyId?: string | null;
    backupEngine?: string | null;
    connectionUriMasked: string;
    internalConnectionUriMasked: string;
  };
}) {
  console.log(chalk.bold(`\n  ${input.database.label} database ${input.serviceName}\n`));
  console.log(`  Service:      ${input.serviceId}`);
  if (input.database.databaseName) console.log(`  Database:     ${input.database.databaseName}`);
  if (input.database.username) console.log(`  User:         ${input.database.username}`);
  console.log(`  Port:         ${input.database.port}`);
  console.log(`  Volume:       ${input.database.volumeName}`);
  console.log(
    `  Backups:      ${
      input.database.backupPolicyId
        ? input.database.backupEngine
          ? `${input.database.backupEngine} policy ${input.database.backupPolicyId}`
          : `volume policy ${input.database.backupPolicyId}`
        : "not linked"
    }`
  );
  console.log(`  Internal URI: ${input.database.internalConnectionUriMasked}`);
  console.log(`  Published URI:${input.database.connectionUriMasked}`);
  console.log();
}
