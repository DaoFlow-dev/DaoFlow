import { db } from "../connection";
import { seedUsers } from "./seed/seed-users";
import { seedInfrastructure } from "./seed/seed-infrastructure";
import { seedDeployments } from "./seed/seed-deployments";
import { seedObservability } from "./seed/seed-observability";

let foundationSeedPromise: Promise<void> | null = null;

/** Lazy-init seed data — caches the promise so it only runs once. */
export function ensureControlPlaneReady() {
  foundationSeedPromise ??= seedControlPlaneData().catch((err) => {
    // Clear the cached promise so the next request retries
    foundationSeedPromise = null;
    console.warn(
      "[seed] Control-plane seed failed (will retry on next request):",
      err instanceof Error ? err.message : String(err)
    );
    throw err;
  });
  return foundationSeedPromise;
}

export function resetControlPlaneSeedState() {
  foundationSeedPromise = null;
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
