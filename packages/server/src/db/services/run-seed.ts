/**
 * Standalone seed script — run via `bun db:seed` from the workspace root.
 *
 * This file is intentionally separate from seed.ts to avoid tsup bundling
 * a process.exit(0) call into the server's dist/index.js. When seed.ts
 * contained an `import.meta.main` guard, tsup would inline it and
 * `import.meta.main` evaluated to true because index.js IS the entry point,
 * causing the production server to exit immediately after seeding.
 */
import { seedControlPlaneData } from "./seed";

seedControlPlaneData()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
