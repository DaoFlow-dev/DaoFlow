import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import { getProcessSingleton } from "../process-singleton";
import * as schema from "./schema";
import { resolveConfiguredDatabaseUrl, resolveTestDatabaseUrl } from "./test-database-url";

const PROCESS_CONNECTION_STATE_KEY = "__daoflowDbConnectionState__";

type DatabaseConnectionState = {
  activeConnectionString: string;
  activePool: pg.Pool;
  db: ReturnType<typeof drizzle>;
  poolProxy: pg.Pool;
};

type PoolPropertyMap = Record<PropertyKey, unknown>;

const TEST_POOL_MAX = 8;
const TEST_POOL_IDLE_TIMEOUT_MS = 1_000;
const TEST_POOL_CONNECTION_TIMEOUT_MS = 15_000;
const TEST_POOL_MAX_USES = 50;
const PROD_POOL_MAX = 20;
const PROD_POOL_IDLE_TIMEOUT_MS = 30_000;
const PROD_POOL_CONNECTION_TIMEOUT_MS = 5_000;

function isTestRuntime() {
  if (process.env.TEST_DATABASE_URL || process.env.VITEST || process.env.NODE_ENV === "test") {
    return true;
  }

  return process.argv.some((arg) => arg.includes("vitest") || arg.includes("vite-node"));
}

function resolveConnectionString() {
  if (isTestRuntime()) {
    return resolveTestDatabaseUrl();
  }

  return resolveConfiguredDatabaseUrl();
}

export function buildPoolConfig(input: {
  connectionString: string;
  testRuntime: boolean;
}): pg.PoolConfig {
  if (input.testRuntime) {
    return {
      connectionString: input.connectionString,
      // The server suite is single-worker and shares one test database.
      // A smaller pool reduces stale idle clients across repeated resets.
      max: TEST_POOL_MAX,
      idleTimeoutMillis: TEST_POOL_IDLE_TIMEOUT_MS,
      connectionTimeoutMillis: TEST_POOL_CONNECTION_TIMEOUT_MS,
      maxUses: TEST_POOL_MAX_USES
    };
  }

  return {
    connectionString: input.connectionString,
    max: PROD_POOL_MAX,
    idleTimeoutMillis: PROD_POOL_IDLE_TIMEOUT_MS,
    connectionTimeoutMillis: PROD_POOL_CONNECTION_TIMEOUT_MS
  };
}

function createPool(connectionString: string) {
  const nextPool = new pg.Pool(
    buildPoolConfig({
      connectionString,
      testRuntime: isTestRuntime()
    })
  );

  // Prevent unhandled 'error' events on idle clients from crashing the process.
  // Without this handler, a dropped connection in the pool kills the server.
  nextPool.on("error", (err) => {
    console.error("[pg pool] Idle client error:", err.message);
  });

  return nextPool;
}

function createPoolProxy(state: Pick<DatabaseConnectionState, "activePool">) {
  return new Proxy({} as pg.Pool, {
    get(_target, property) {
      const value = (state.activePool as unknown as PoolPropertyMap)[property];

      if (typeof value !== "function") {
        return value;
      }

      const boundValue = value.bind(state.activePool) as (...args: unknown[]) => unknown;
      return (...args: unknown[]) => boundValue(...args);
    },
    set(_target, property, value) {
      const activePool = state.activePool as unknown as PoolPropertyMap;
      activePool[property] = value;
      return true;
    },
    has(_target, property) {
      return property in state.activePool;
    },
    ownKeys() {
      return Reflect.ownKeys(state.activePool);
    },
    getOwnPropertyDescriptor(_target, property) {
      return Object.getOwnPropertyDescriptor(state.activePool, property);
    }
  });
}

function initializeConnectionState(): DatabaseConnectionState {
  const state = {} as DatabaseConnectionState;

  state.activeConnectionString = resolveConnectionString();
  state.activePool = createPool(state.activeConnectionString);
  state.poolProxy = createPoolProxy(state);
  state.db = drizzle(state.poolProxy, { schema });

  return state;
}

function getConnectionState() {
  return getProcessSingleton(PROCESS_CONNECTION_STATE_KEY, initializeConnectionState);
}

export const pool = getConnectionState().poolProxy;

export const db = getConnectionState().db;

export function getDatabaseConnectionString() {
  return getConnectionState().activeConnectionString;
}

export async function reinitializeDatabaseConnection(input?: {
  connectionString?: string;
  force?: boolean;
}) {
  const state = getConnectionState();
  const connectionString = input?.connectionString ?? resolveConnectionString();

  if (!input?.force && connectionString === state.activeConnectionString) {
    return;
  }

  const previousPool = state.activePool;
  state.activeConnectionString = connectionString;
  state.activePool = createPool(connectionString);

  await previousPool.end().catch(() => undefined);
}
