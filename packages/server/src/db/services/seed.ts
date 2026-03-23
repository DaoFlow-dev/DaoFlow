import { db } from "../connection";
import { seedUsers } from "./seed/seed-users";
import { seedInfrastructure } from "./seed/seed-infrastructure";
import { seedDeployments } from "./seed/seed-deployments";
import { seedObservability } from "./seed/seed-observability";
import { getProcessValueAccessor } from "../../process-singleton";

const PROCESS_SEED_PROMISE_KEY = "__daoflowFoundationSeedPromise__";

function getFoundationSeedPromise() {
  return getProcessValueAccessor<Promise<void> | null>(PROCESS_SEED_PROMISE_KEY, null);
}

/** Lazy-init seed data — caches the promise so it only runs once. */
export function ensureControlPlaneReady() {
  const state = getFoundationSeedPromise();

  state.current ??= seedControlPlaneData().catch((err) => {
    // Clear the cached promise so the next request retries
    state.current = null;
    console.warn(
      "[seed] Control-plane seed failed (will retry on next request):",
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  });

  return state.current;
}

export function resetControlPlaneSeedState() {
  getFoundationSeedPromise().current = null;
}

export async function waitForControlPlaneSeedIdle() {
  await getFoundationSeedPromise().current;
}

export function primeControlPlaneSeedState() {
  getFoundationSeedPromise().current = Promise.resolve();
}

/**
 * Should we seed demo fixture data?
 *
 * - Vitest sets `VITEST` automatically — unit/integration tests always get fixtures.
 * - E2E CI can opt in via `DAOFLOW_SEED_DEMO=1`.
 * - Production installs never set either, so they start with a clean slate.
 */
function shouldSeedDemo(): boolean {
  return Boolean(process.env.VITEST || process.env.DAOFLOW_SEED_DEMO);
}

/**
 * Bootstrap the minimum control-plane state needed for first login.
 *
 * In production only the admin user is seeded. The real localhost server
 * is auto-registered by bootstrap-localhost-server.ts, and the dashboard
 * shows actual container state instead of phantom deployment records.
 *
 * In test/CI environments the full demo dataset (infrastructure,
 * deployments, observability) is seeded so tests have fixture data.
 */
export async function seedControlPlaneData() {
  const seedDemo = shouldSeedDemo();

  await db.transaction(async (tx) => {
    await seedUsers(tx);

    if (seedDemo) {
      await seedInfrastructure(tx);
      await seedDeployments(tx);
      await seedObservability(tx);
    }
  });

  console.log(
    seedDemo
      ? "Seeded DaoFlow foundation control-plane data (demo fixtures)."
      : "Seeded DaoFlow admin bootstrap data."
  );
}
