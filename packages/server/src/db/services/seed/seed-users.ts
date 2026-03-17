import { users } from "../../schema/users";
import { teams, teamMembers } from "../../schema/teams";
import { principals } from "../../schema/tokens";
import { apiTokens } from "../../schema/tokens";
import { daysBefore, hoursBefore, minutesBefore } from "./seed-helpers";
import type { SeedTransaction } from "./seed-types";

export async function seedUsers(tx: SeedTransaction) {
  await tx
    .insert(users)
    .values([
      {
        id: "user_foundation_owner",
        email: "owner@daoflow.local",
        name: "Foundation Owner",
        username: "foundation-owner",
        emailVerified: true,
        role: "owner",
        status: "active",
        createdAt: daysBefore(30),
        updatedAt: minutesBefore(2)
      },
      {
        id: "user_foundation_operator",
        email: "operator@daoflow.local",
        name: "Foundation Operator",
        username: "foundation-operator",
        emailVerified: true,
        role: "operator",
        status: "active",
        createdAt: daysBefore(28),
        updatedAt: daysBefore(1)
      },
      {
        id: "user_developer",
        email: "developer@daoflow.local",
        name: "Foundation Developer",
        username: "foundation-developer",
        emailVerified: true,
        role: "developer",
        status: "active",
        createdAt: daysBefore(21),
        updatedAt: daysBefore(1)
      },
      {
        id: "user_observer_agent",
        email: "observer-agent@daoflow.local",
        name: "Observer Agent",
        username: "observer-agent",
        emailVerified: true,
        role: "agent",
        status: "active",
        createdAt: daysBefore(18),
        updatedAt: hoursBefore(8)
      },
      {
        id: "user_planner_agent",
        email: "planner-agent@daoflow.local",
        name: "Planner Agent",
        username: "planner-agent",
        emailVerified: true,
        role: "agent",
        status: "active",
        createdAt: daysBefore(14),
        updatedAt: hoursBefore(2)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(teams)
    .values({
      id: "team_foundation",
      name: "Foundation Team",
      slug: "foundation",
      status: "active",
      createdByUserId: "user_foundation_owner",
      createdAt: daysBefore(30),
      updatedAt: daysBefore(30)
    })
    .onConflictDoNothing();

  await tx
    .insert(teamMembers)
    .values([
      {
        id: 7001,
        teamId: "team_foundation",
        userId: "user_foundation_owner",
        role: "owner",
        createdAt: daysBefore(30)
      },
      {
        id: 7002,
        teamId: "team_foundation",
        userId: "user_foundation_operator",
        role: "admin",
        createdAt: daysBefore(28)
      },
      {
        id: 7003,
        teamId: "team_foundation",
        userId: "user_developer",
        role: "member",
        createdAt: daysBefore(21)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(principals)
    .values([
      {
        id: "principal_observer_agent_1",
        type: "agent",
        name: "observer-agent",
        description: "Read-only deployment observer.",
        linkedUserId: "user_observer_agent",
        defaultScopes: "server:read,deploy:read,service:read,logs:read,events:read",
        status: "active",
        createdAt: daysBefore(12),
        updatedAt: daysBefore(12)
      },
      {
        id: "principal_planner_agent_1",
        type: "agent",
        name: "planner-agent",
        description: "Planning-only automation identity.",
        linkedUserId: "user_planner_agent",
        defaultScopes:
          "server:read,deploy:read,service:read,logs:read,events:read,approvals:create",
        status: "active",
        createdAt: daysBefore(5),
        updatedAt: daysBefore(5)
      },
      {
        id: "principal_release_service_1",
        type: "service",
        name: "release-service",
        description: "Paused command-capable release automation.",
        linkedUserId: null,
        defaultScopes:
          "server:read,deploy:read,deploy:start,service:read,logs:read,events:read,approvals:create",
        status: "paused",
        createdAt: daysBefore(16),
        updatedAt: daysBefore(16)
      }
    ])
    .onConflictDoNothing();

  await tx
    .insert(apiTokens)
    .values([
      {
        id: "token_observer_readonly",
        name: "readonly-observer",
        tokenHash: "seed_token_hash_observer_readonly",
        tokenPrefix: "df_read_4f39",
        principalType: "agent",
        principalId: "principal_observer_agent_1",
        scopes: "server:read,deploy:read,service:read,logs:read,events:read",
        status: "active",
        lastUsedAt: minutesBefore(6),
        expiresAt: null,
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(12),
        revokedAt: null
      },
      {
        id: "token_planner_agent",
        name: "planner-agent",
        tokenHash: "seed_token_hash_planner_agent",
        tokenPrefix: "df_plan_7ab2",
        principalType: "agent",
        principalId: "principal_planner_agent_1",
        scopes: "server:read,deploy:read,service:read,logs:read,events:read,approvals:create",
        status: "active",
        lastUsedAt: hoursBefore(2),
        expiresAt: daysBefore(-25),
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(5),
        revokedAt: null
      },
      {
        id: "token_release_service",
        name: "release-service",
        tokenHash: "seed_token_hash_release_service",
        tokenPrefix: "df_cmd_2cd8",
        principalType: "service",
        principalId: "principal_release_service_1",
        scopes:
          "server:read,deploy:read,deploy:start,service:read,logs:read,events:read,approvals:create",
        status: "paused",
        lastUsedAt: hoursBefore(19),
        expiresAt: null,
        createdByUserId: "user_foundation_owner",
        createdAt: daysBefore(16),
        revokedAt: null
      }
    ])
    .onConflictDoNothing();
}
