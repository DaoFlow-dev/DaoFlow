// Barrel merge for backward compatibility.
// The command router was split from 865 lines into 5 domain-specific files:
//   command-deploy.ts   — deployments, compose, env vars, execution, rollback
//   command-admin.ts    — servers, projects, environments, services, agents, approvals
//   command-git.ts      — git providers, OAuth
//   command-backup.ts   — backup runs, restores, destinations
//   command-secrets.ts  — 1Password and external secret providers
import { t } from "../trpc";
import { deployRouter } from "./command-deploy";
import { adminRouter } from "./command-admin";
import { gitRouter } from "./command-git";
import { backupRouter } from "./command-backup";
import { secretsRouter } from "./command-secrets";

export const commandRouter = t.mergeRouters(
  deployRouter,
  adminRouter,
  gitRouter,
  backupRouter,
  secretsRouter
);
