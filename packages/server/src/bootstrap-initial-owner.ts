import { sql, eq } from "drizzle-orm";
import { auth } from "./auth";
import { db } from "./db/connection";
import { users } from "./db/schema/users";
import { getProcessValueAccessor } from "./process-singleton";

const INITIAL_OWNER_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
const INITIAL_OWNER_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";
const INITIAL_OWNER_NAME = "DaoFlow Owner";

const PROCESS_INITIAL_OWNER_PROMISE_KEY = "__daoflowInitialOwnerBootstrapPromise__";

function getInitialOwnerBootstrapPromise() {
  return getProcessValueAccessor<Promise<void> | null>(PROCESS_INITIAL_OWNER_PROMISE_KEY, null);
}

function readInitialOwnerConfig() {
  const email = process.env[INITIAL_OWNER_EMAIL_ENV]?.trim().toLowerCase();
  const password = process.env[INITIAL_OWNER_PASSWORD_ENV]?.trim();

  if (!email || !password) {
    return null;
  }

  return { email, password };
}

export function resetInitialOwnerBootstrapState() {
  getInitialOwnerBootstrapPromise().current = null;
}

export async function waitForInitialOwnerBootstrapIdle() {
  await getInitialOwnerBootstrapPromise().current;
}

export function ensureInitialOwnerFromEnv() {
  const config = readInitialOwnerConfig();
  if (!config) {
    return Promise.resolve();
  }

  const state = getInitialOwnerBootstrapPromise();

  state.current ??= bootstrapInitialOwner(config).catch((error) => {
    state.current = null;
    throw error;
  });

  return state.current;
}

async function bootstrapInitialOwner(config: { email: string; password: string }) {
  const [existingUser] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, config.email))
    .limit(1);

  if (existingUser) {
    console.log(`[auth] Initial owner ${config.email} already exists; bootstrap skipped`);
    return;
  }

  const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
  if (Number(result.count) > 0) {
    console.log(
      `[auth] Initial owner bootstrap skipped because ${result.count} user(s) already exist`
    );
    return;
  }

  await auth.api.signUpEmail({
    body: {
      name: INITIAL_OWNER_NAME,
      email: config.email,
      password: config.password
    }
  });

  console.log(`[auth] Bootstrapped initial owner ${config.email} from environment`);
}
