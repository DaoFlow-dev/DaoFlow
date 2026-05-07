const connectionString = process.argv[2];
const source = process.argv[3] ?? "DATABASE_URL";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);

function fail(message: string): never {
  console.error(`[e2e-db-guard] ${message}`);
  process.exit(1);
}

if (!connectionString) {
  fail(`${source} is required before resetting an E2E database.`);
}

let url: URL;
try {
  url = new URL(connectionString);
} catch {
  fail(`${source} must be a valid PostgreSQL connection URL.`);
}

if (!["postgres:", "postgresql:"].includes(url.protocol)) {
  fail(`${source} must use the postgres or postgresql protocol.`);
}

const databaseName = decodeURIComponent(url.pathname.replace(/^\//, ""));
if (!databaseName) {
  fail(`${source} must include a database name.`);
}

const hasSafeDatabaseName = databaseName.includes("e2e") || databaseName.endsWith("_test");
if (!hasSafeDatabaseName) {
  fail(
    `${source} database "${databaseName}" is not an E2E/test database. ` +
      "Use a database name containing 'e2e' or ending in '_test'."
  );
}

const allowRemoteReset = process.env.DAOFLOW_E2E_ALLOW_REMOTE_DATABASE_RESET === "true";
if (!allowRemoteReset && !LOCAL_HOSTS.has(url.hostname)) {
  fail(
    `${source} host "${url.hostname}" is not local. ` +
      "Set DAOFLOW_E2E_ALLOW_REMOTE_DATABASE_RESET=true only for an intentional remote test DB."
  );
}
