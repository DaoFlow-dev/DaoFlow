import { and, asc, eq, sql } from "drizzle-orm";
import { bootstrapOwnerRole } from "@daoflow/shared";
import { auth } from "./auth";
import { db } from "./db/connection";
import { newId } from "./db/services/json-helpers";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { getProcessValueAccessor } from "./process-singleton";

const INITIAL_OWNER_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
const INITIAL_OWNER_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";
const INITIAL_OWNER_NAME = "DaoFlow Owner";
const INITIAL_OWNER_TEAM_NAME = "DaoFlow";

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
  let owner = await findInitialOwner(config.email);

  if (!owner) {
    const [result] = await db.select({ count: sql<number>`count(*)` }).from(users);
    if (Number(result.count) > 0) {
      owner = await findInitialOwner(config.email);
      if (!owner) {
        console.log(
          `[auth] Initial owner bootstrap skipped because ${result.count} user(s) already exist`
        );
        return;
      }
    }

    if (!owner) {
      try {
        await auth.api.signUpEmail({
          body: {
            name: INITIAL_OWNER_NAME,
            email: config.email,
            password: config.password
          }
        });
      } catch (error) {
        const winningOwner = await findInitialOwner(config.email);
        if (!winningOwner || winningOwner.role !== bootstrapOwnerRole) {
          throw error;
        }

        owner = winningOwner;
        console.log(
          `[auth] Initial owner ${config.email} was created by another startup process; continuing`
        );
      }

      if (!owner) {
        owner = await findInitialOwner(config.email);
        if (!owner) {
          throw new Error(`Initial owner ${config.email} was created but could not be reloaded`);
        }

        console.log(`[auth] Bootstrapped initial owner ${config.email} from environment`);
      }
    }
  }

  if (owner.role !== bootstrapOwnerRole) {
    console.log(
      `[auth] Initial owner ${config.email} already exists without the owner role; bootstrap skipped`
    );
    return;
  }

  const teamId = await ensureInitialOwnerTeam(owner.id);
  console.log(`[auth] Initial owner ${config.email} is ready in team ${teamId}`);
}

async function findInitialOwner(email: string) {
  const [owner] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, email))
    .limit(1);

  return owner;
}

async function ensureInitialOwnerTeam(userId: string) {
  return db.transaction(async (tx) => {
    const [owner] = await tx
      .select({ defaultTeamId: users.defaultTeamId })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
      .for("update");

    if (!owner) {
      throw new Error(`Initial owner ${userId} no longer exists`);
    }

    let membership = owner.defaultTeamId
      ? (
          await tx
            .select({ id: teamMembers.id, teamId: teamMembers.teamId })
            .from(teamMembers)
            .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, owner.defaultTeamId)))
            .limit(1)
        )[0]
      : undefined;

    if (!membership) {
      [membership] = await tx
        .select({ id: teamMembers.id, teamId: teamMembers.teamId })
        .from(teamMembers)
        .where(eq(teamMembers.userId, userId))
        .orderBy(asc(teamMembers.createdAt), asc(teamMembers.id))
        .limit(1);
    }

    let teamId = membership?.teamId;

    if (!teamId) {
      teamId = newId();
      await tx.insert(teams).values({
        id: teamId,
        name: INITIAL_OWNER_TEAM_NAME,
        createdByUserId: userId,
        updatedAt: new Date()
      });

      await tx.insert(teamMembers).values({
        teamId,
        userId,
        role: "owner",
        createdAt: new Date()
      });
    }

    if (owner.defaultTeamId !== teamId) {
      await tx
        .update(users)
        .set({ defaultTeamId: teamId, updatedAt: new Date() })
        .where(eq(users.id, userId));
    }

    return teamId;
  });
}
