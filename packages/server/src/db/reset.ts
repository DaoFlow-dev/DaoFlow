import { ensureDatabaseExists, resetDatabaseSchema } from "./reset-database";

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("DATABASE_URL is not set");
    process.exit(1);
  }

  await ensureDatabaseExists(connectionString);
  await resetDatabaseSchema(connectionString);
  console.log("Database schema reset ✓");
}

void main();
