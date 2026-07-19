import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetInitialOwnerBootstrapState } from "./bootstrap-initial-owner";
import { db } from "./db/connection";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { resetTestDatabase } from "./test-db";

const INITIAL_OWNER_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
const INITIAL_OWNER_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";
const signUpEmailMock = vi.fn();

let resetIsolatedBootstrapState: (() => void) | undefined;

async function importIsolatedBootstrap() {
  vi.resetModules();
  vi.doMock("./auth", () => ({
    auth: {
      api: {
        signUpEmail: signUpEmailMock
      }
    }
  }));

  const bootstrap = await import("./bootstrap-initial-owner");
  resetIsolatedBootstrapState = bootstrap.resetInitialOwnerBootstrapState;
  return bootstrap;
}

describe("bootstrapInitialOwner concurrency", () => {
  let originalEmail: string | undefined;
  let originalPassword: string | undefined;

  beforeEach(async () => {
    originalEmail = process.env[INITIAL_OWNER_EMAIL_ENV];
    originalPassword = process.env[INITIAL_OWNER_PASSWORD_ENV];
    delete process.env[INITIAL_OWNER_EMAIL_ENV];
    delete process.env[INITIAL_OWNER_PASSWORD_ENV];
    signUpEmailMock.mockReset();
    await resetTestDatabase();
    resetInitialOwnerBootstrapState();
  });

  afterEach(() => {
    if (originalEmail === undefined) {
      delete process.env[INITIAL_OWNER_EMAIL_ENV];
    } else {
      process.env[INITIAL_OWNER_EMAIL_ENV] = originalEmail;
    }

    if (originalPassword === undefined) {
      delete process.env[INITIAL_OWNER_PASSWORD_ENV];
    } else {
      process.env[INITIAL_OWNER_PASSWORD_ENV] = originalPassword;
    }

    resetIsolatedBootstrapState?.();
    resetIsolatedBootstrapState = undefined;
    resetInitialOwnerBootstrapState();
    vi.doUnmock("./auth");
    vi.resetModules();
  });

  it("recovers both independent startups after a real unique-email race", async () => {
    const email = "concurrent-bootstrap-owner@daoflow.local";
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";
    const bootstrap = await importIsolatedBootstrap();

    let arrivals = 0;
    let releaseSignups: (() => void) | undefined;
    const bothAtSignUp = new Promise<void>((resolve) => {
      releaseSignups = resolve;
    });

    signUpEmailMock.mockImplementation(
      async (input: { body: { email: string; name: string; password: string } }) => {
        const contender = arrivals;
        arrivals += 1;
        if (arrivals === 2) {
          releaseSignups?.();
        }
        await bothAtSignUp;

        await db.insert(users).values({
          id: `user_race_${contender}`,
          email: input.body.email,
          name: input.body.name,
          emailVerified: false,
          role: "owner",
          status: "active",
          updatedAt: new Date()
        });
      }
    );

    const firstStartup = bootstrap.ensureInitialOwnerFromEnv();
    bootstrap.resetInitialOwnerBootstrapState();
    const secondStartup = bootstrap.ensureInitialOwnerFromEnv();

    await Promise.all([firstStartup, secondStartup]);

    const matchingUsers = await db.select().from(users).where(eq(users.email, email));
    expect(signUpEmailMock).toHaveBeenCalledTimes(2);
    expect(matchingUsers).toHaveLength(1);

    const owner = matchingUsers[0];
    if (!owner) {
      throw new Error("Concurrent bootstrap did not create an owner");
    }

    const ownerTeams = await db.select().from(teams).where(eq(teams.createdByUserId, owner.id));
    expect(ownerTeams).toHaveLength(1);

    const team = ownerTeams[0];
    if (!team) {
      throw new Error("Concurrent bootstrap did not create an owner team");
    }

    const memberships = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, owner.id)));
    expect(owner.defaultTeamId).toBe(team.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "owner" });
  });

  it("still surfaces signup failures when no competing owner won", async () => {
    const email = "failed-bootstrap-owner@daoflow.local";
    const signupFailure = new Error("password policy rejected the signup");
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";
    signUpEmailMock.mockRejectedValue(signupFailure);
    const bootstrap = await importIsolatedBootstrap();

    await expect(bootstrap.ensureInitialOwnerFromEnv()).rejects.toBe(signupFailure);

    const matchingUsers = await db.select().from(users).where(eq(users.email, email));
    expect(matchingUsers).toHaveLength(0);
  });
});
