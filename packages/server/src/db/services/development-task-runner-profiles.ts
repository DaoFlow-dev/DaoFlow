import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import { db } from "../connection";
import { sandboxRunnerProfiles } from "../schema/development-tasks";
import { servers } from "../schema/servers";
import { resolveSandboxRunnerCapabilities } from "./development-task-runner-capabilities";
import {
  DEFAULT_BOXLITE_RUNNER_PROFILE_ID,
  DEFAULT_HOST_RUNNER_PROFILE_ID
} from "./default-development-runner";
import { asRecord } from "./json-helpers";

const DEFAULT_SANDBOX_RUNNER_PROFILE_IDS = [
  DEFAULT_HOST_RUNNER_PROFILE_ID,
  DEFAULT_BOXLITE_RUNNER_PROFILE_ID
];

export async function listSandboxRunnerProfiles(input?: {
  status?: string;
  teamId?: string;
  limit?: number;
}) {
  const statuses = input?.status ? [input.status] : ["enabled", "disabled"];
  const query = db
    .select({
      profile: sandboxRunnerProfiles,
      server: {
        id: servers.id,
        name: servers.name,
        status: servers.status
      }
    })
    .from(sandboxRunnerProfiles)
    .leftJoin(servers, eq(servers.id, sandboxRunnerProfiles.serverId));
  const filters = [
    inArray(sandboxRunnerProfiles.status, statuses),
    input?.teamId
      ? or(
          eq(servers.teamId, input.teamId),
          and(
            isNull(sandboxRunnerProfiles.serverId),
            inArray(sandboxRunnerProfiles.id, DEFAULT_SANDBOX_RUNNER_PROFILE_IDS)
          )
        )
      : undefined
  ].filter((filter): filter is Exclude<typeof filter, undefined> => Boolean(filter));
  const rows = await query
    .where(and(...filters))
    .orderBy(desc(sandboxRunnerProfiles.createdAt))
    .limit(input?.limit ?? 24);

  return rows.map(({ profile, server }) => {
    const metadata = asRecord(profile.metadata);
    return {
      ...profile,
      server,
      metadata,
      capabilities: resolveSandboxRunnerCapabilities({ provider: profile.provider, metadata })
    };
  });
}
