import { fetchGitHubInstallationAccessToken } from "../db/services/github-app-auth";
import { resolveGitLabInstallationApiAccess } from "../db/services/gitlab-installation-auth";
import { buildGitHubApiBaseUrl } from "../db/services/project-source-provider-validation-shared";
import { resolveGitLabApiBaseUrl } from "../db/services/gitlab-urls";
import type { WebhookTarget } from "./webhooks-types";

const ALLOWED_GITHUB_PERMISSIONS = new Set(["admin", "maintain", "write"]);
const GITLAB_DEVELOPER_ACCESS_LEVEL = 30;

export interface DevelopmentTaskActorAuthorization {
  ok: boolean;
  reason?: string;
  permission?: string | null;
}

function encodeGitLabProjectPath(repoFullName: string) {
  return encodeURIComponent(repoFullName);
}

function readString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function readGitHubPermission(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  return readString((payload as Record<string, unknown>).permission);
}

function readGitLabAccessLevel(payload: unknown, actorUsername: string) {
  if (!Array.isArray(payload)) {
    return null;
  }

  const actor = actorUsername.toLowerCase();
  let row: Record<string, unknown> | null = null;
  for (const item of payload) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      continue;
    }

    const record = item as Record<string, unknown>;
    const username = readString(record.username);
    if (username?.toLowerCase() === actor) {
      row = record;
      break;
    }
  }

  if (!row) {
    return null;
  }

  const accessLevel = row.access_level;
  return typeof accessLevel === "number" && Number.isFinite(accessLevel) ? accessLevel : null;
}

export async function authorizeGitHubDevelopmentTaskActor(input: {
  target: WebhookTarget;
  repoFullName: string;
  actorLogin?: string | null;
}): Promise<DevelopmentTaskActorAuthorization> {
  const actorLogin = input.actorLogin?.trim();
  if (!actorLogin || !input.target.installation) {
    return { ok: false, reason: "missing_actor_or_installation" };
  }

  const token = await fetchGitHubInstallationAccessToken({
    provider: input.target.provider,
    installation: input.target.installation
  });
  const response = await fetch(
    `${buildGitHubApiBaseUrl(input.target.provider.baseUrl)}/repos/${input.repoFullName}/collaborators/${encodeURIComponent(
      actorLogin
    )}/permission`,
    {
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${token}`,
        "User-Agent": "DaoFlow"
      },
      signal: AbortSignal.timeout(10_000)
    }
  );

  if (!response.ok) {
    return { ok: false, reason: `permission_check_failed_${response.status}` };
  }

  const permission = readGitHubPermission(await response.json());
  return permission && ALLOWED_GITHUB_PERMISSIONS.has(permission)
    ? { ok: true, permission }
    : { ok: false, reason: "insufficient_repository_permission", permission: permission ?? null };
}

export async function authorizeGitLabDevelopmentTaskActor(input: {
  target: WebhookTarget;
  repoFullName: string;
  actorUsername?: string | null;
}): Promise<DevelopmentTaskActorAuthorization> {
  const actorUsername = input.actorUsername?.trim();
  if (!actorUsername || !input.target.installation) {
    return { ok: false, reason: "missing_actor_or_installation" };
  }

  const apiAccess = await resolveGitLabInstallationApiAccess({
    provider: input.target.provider,
    installation: input.target.installation
  });
  if (apiAccess.status === "capability_unavailable") {
    return { ok: false, reason: "api_capability_unavailable" };
  }
  if (apiAccess.status !== "ok") {
    return { ok: false, reason: "missing_installation_access_token" };
  }

  const apiBaseUrl = resolveGitLabApiBaseUrl(input.target.provider);
  const response = await fetch(
    `${apiBaseUrl}/projects/${encodeGitLabProjectPath(input.repoFullName)}/members/all?query=${encodeURIComponent(
      actorUsername
    )}`,
    {
      headers: {
        Accept: "application/json",
        "User-Agent": "DaoFlow",
        ...apiAccess.headers
      },
      signal: AbortSignal.timeout(10_000)
    }
  );

  if (!response.ok) {
    return { ok: false, reason: `permission_check_failed_${response.status}` };
  }

  const accessLevel = readGitLabAccessLevel(await response.json(), actorUsername);
  return accessLevel !== null && accessLevel >= GITLAB_DEVELOPER_ACCESS_LEVEL
    ? { ok: true, permission: `access_level:${accessLevel}` }
    : {
        ok: false,
        reason: "insufficient_project_permission",
        permission: accessLevel === null ? null : `access_level:${accessLevel}`
      };
}
