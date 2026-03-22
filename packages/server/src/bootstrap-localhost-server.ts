import { eq } from "drizzle-orm";
import { db } from "./db/connection";
import { servers } from "./db/schema/servers";
import { verifyServerReadiness } from "./db/services/server-readiness";
import { newId } from "./db/services/json-helpers";
import { getProcessValueAccessor } from "./process-singleton";

const LOCALHOST_SERVER_NAME = "localhost";
const LOCALHOST_HOST = "localhost";
const PROCESS_KEY = "__daoflowLocalhostServerBootstrapPromise__";

function getLocalhostBootstrapPromise() {
  return getProcessValueAccessor<Promise<void> | null>(PROCESS_KEY, null);
}

export function resetLocalhostServerBootstrapState() {
  getLocalhostBootstrapPromise().current = null;
}

export async function waitForLocalhostServerBootstrapIdle() {
  await getLocalhostBootstrapPromise().current;
}

/**
 * Auto-register a localhost server when the Docker socket is available.
 *
 * This makes the DaoFlow host a default deployment target — like Coolify
 * and Dokploy — so users can deploy compose projects immediately after
 * install without manually adding a server first.
 *
 * Idempotent: skips if a server with host "localhost" already exists.
 */
export function ensureLocalhostServer() {
  const state = getLocalhostBootstrapPromise();

  state.current ??= bootstrapLocalhostServer().catch((error) => {
    state.current = null;
    throw error;
  });

  return state.current;
}

async function bootstrapLocalhostServer() {
  const [existing] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.host, LOCALHOST_HOST))
    .limit(1);

  if (existing) {
    console.log("[bootstrap] Localhost server already registered; skipping");
    return;
  }

  const serverId = newId();
  const [server] = await db
    .insert(servers)
    .values({
      id: serverId,
      name: LOCALHOST_SERVER_NAME,
      host: LOCALHOST_HOST,
      region: "local",
      sshPort: 22,
      kind: "docker-engine",
      status: "pending verification",
      metadata: {},
      updatedAt: new Date()
    })
    .onConflictDoNothing()
    .returning();

  if (!server) {
    console.error("[bootstrap] Failed to insert localhost server row");
    return;
  }

  await verifyServerReadiness(server);
  console.log(`[bootstrap] Registered localhost server (${serverId})`);
}
