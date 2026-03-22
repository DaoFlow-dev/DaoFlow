import pg from "pg";

const { Client } = pg;

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

export async function ensureDatabaseExists(connectionString: string) {
  const targetUrl = new URL(connectionString);
  const databaseName = targetUrl.pathname.replace(/^\//, "");
  const adminUrl = new URL(connectionString);
  adminUrl.pathname = "/postgres";

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existing = await client.query("select 1 from pg_database where datname = $1", [
      databaseName
    ]);

    if (existing.rowCount === 0) {
      await client.query(`create database ${quoteIdentifier(databaseName)}`);
    }
  } finally {
    await client.end();
  }
}

export async function resetDatabaseSchema(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query(`
      DROP SCHEMA IF EXISTS drizzle CASCADE;
      DROP SCHEMA IF EXISTS public CASCADE;
      CREATE SCHEMA public;
      GRANT ALL ON SCHEMA public TO CURRENT_USER;
      GRANT ALL ON SCHEMA public TO public;
      CREATE EXTENSION IF NOT EXISTS vector;
    `);
  } finally {
    await client.end();
  }
}

export async function truncateDatabaseTables(connectionString: string) {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const tableResult = await client.query<{ qualifiedName: string }>(`
      SELECT format('%I.%I', schemaname, tablename) AS "qualifiedName"
      FROM pg_tables
      WHERE schemaname = 'public'
    `);

    if (tableResult.rows.length === 0) {
      return;
    }

    const sequenceResult = await client.query<{ qualifiedName: string }>(`
      SELECT format('%I.%I', sequence_schema, sequence_name) AS "qualifiedName"
      FROM information_schema.sequences
      WHERE sequence_schema = 'public'
    `);

    await client.query("SET session_replication_role = replica");
    try {
      for (const row of tableResult.rows) {
        await client.query(`DELETE FROM ${row.qualifiedName}`);
      }
    } finally {
      await client.query("SET session_replication_role = DEFAULT");
    }

    for (const row of sequenceResult.rows) {
      await client.query(`ALTER SEQUENCE ${row.qualifiedName} RESTART WITH 1`);
    }
  } finally {
    await client.end();
  }
}
