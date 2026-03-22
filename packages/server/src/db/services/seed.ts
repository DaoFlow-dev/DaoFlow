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

export async function seedControlPlaneData() {
  await db.transaction(async (tx) => {
    await seedUsers(tx);
    await seedInfrastructure(tx);
    await seedDeployments(tx);
    await seedObservability(tx);
  });

  console.log("Seeded DaoFlow foundation control-plane data.");
}
