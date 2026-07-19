import type { RecoveryDatabaseEvidence } from "./control-plane-recovery-restore-types";

const SHA256 = /^[a-f0-9]{64}$/;

function sqlString(value: string): string {
  return `'${value.replaceAll("'", "''")}'`;
}

function fingerprint(table: string, row: string, orderBy: string): string {
  return `(SELECT encode(sha256(COALESCE(string_agg(${row}, E'\\n' ORDER BY ${orderBy}), '')::bytea), 'hex') FROM ${table})`;
}

export function buildRecoveryEvidenceSql(verificationEmail: string): string {
  const email = sqlString(verificationEmail.trim().toLowerCase());
  return `SELECT json_build_object(
    'teams', (SELECT count(*)::int FROM teams),
    'users', (SELECT count(*)::int FROM users),
    'userIdentities', (SELECT count(*)::int FROM user_identities),
    'teamMembers', (SELECT count(*)::int FROM team_members),
    'projects', (SELECT count(*)::int FROM projects),
    'servers', (SELECT count(*)::int FROM servers),
    'auditEntries', (SELECT count(*)::int FROM audit_entries),
    'backupPolicies', (SELECT count(*)::int FROM backup_policies),
    'backupRuns', (SELECT count(*)::int FROM backup_runs),
    'orphanTeamMembers', (SELECT count(*)::int FROM team_members member LEFT JOIN teams team ON team.id = member.team_id LEFT JOIN users usr ON usr.id = member.user_id WHERE team.id IS NULL OR usr.id IS NULL),
    'orphanProjects', (SELECT count(*)::int FROM projects project LEFT JOIN teams team ON team.id = project.team_id WHERE team.id IS NULL),
    'orphanServers', (SELECT count(*)::int FROM servers server LEFT JOIN teams team ON team.id = server.team_id WHERE server.team_id IS NOT NULL AND team.id IS NULL),
    'fingerprints', json_build_object(
      'teams', ${fingerprint("teams", "json_build_array(id, name, slug, status, created_by_user_id)::text", "id")},
      'users', ${fingerprint("users", "json_build_array(id, lower(email), role, status, default_team_id)::text", "id")},
      'userIdentities', ${fingerprint("user_identities", "json_build_array(id, user_id, provider, provider_user_id, password_hash)::text", "id")},
      'teamMembers', ${fingerprint("team_members", "json_build_array(team_id, user_id, role)::text", "team_id, user_id, id")},
      'projects', ${fingerprint("projects", "json_build_array(id, team_id)::text", "id")},
      'auditEntries', ${fingerprint("audit_entries", "json_build_array(id, actor_type, actor_id, actor_role, target_resource, action, permission_scope, outcome)::text", "id")},
      'backupPolicies', ${fingerprint("backup_policies", "json_build_array(id, name, volume_id, backup_type, database_engine, turn_off, schedule, retention_days, retention_daily, retention_weekly, retention_monthly, max_backups, storage_target, destination_id, temporal_workflow_id, status, created_at, updated_at)::text", "id")},
      'backupRuns', ${fingerprint("backup_runs", "json_build_array(id, policy_id)::text", "id")}
    ),
    'projectsById', (SELECT COALESCE(json_agg(json_build_object('id', id, 'teamId', team_id) ORDER BY id), '[]'::json) FROM projects),
    'serversById', (SELECT COALESCE(json_agg(json_build_object('id', id, 'teamId', team_id) ORDER BY id), '[]'::json) FROM servers),
    'backupPoliciesById', (SELECT COALESCE(json_agg(json_build_object('id', policy.id, 'teamId', server.team_id) ORDER BY policy.id), '[]'::json) FROM backup_policies policy INNER JOIN volumes volume ON volume.id = policy.volume_id INNER JOIN servers server ON server.id = volume.server_id),
    'backupRunsById', (SELECT COALESCE(json_agg(json_build_object('id', run.id, 'policyId', run.policy_id) ORDER BY run.id), '[]'::json) FROM backup_runs run),
    'verificationPrincipal', (
      SELECT json_build_object(
        'id', usr.id,
        'email', lower(usr.email),
        'role', usr.role,
        'activeTeamId', COALESCE(
          (SELECT member.team_id FROM team_members member WHERE member.user_id = usr.id AND member.team_id = usr.default_team_id LIMIT 1),
          (SELECT member.team_id FROM team_members member WHERE member.user_id = usr.id ORDER BY member.created_at, member.id LIMIT 1)
        )
      )
      FROM users usr
      WHERE lower(usr.email) = ${email}
      LIMIT 1
    )
  )::text;`;
}

function isIdentityRows(value: unknown, key: "teamId" | "policyId"): boolean {
  return (
    Array.isArray(value) &&
    value.every(
      (row) =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as { id?: unknown }).id === "string" &&
        (typeof (row as Record<string, unknown>)[key] === "string" ||
          (key === "teamId" && (row as Record<string, unknown>)[key] === null))
    )
  );
}

export function assertRecoveryDatabaseEvidence(value: unknown): RecoveryDatabaseEvidence {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Restored database evidence is invalid.");
  }
  const evidence = value as RecoveryDatabaseEvidence;
  const counts = [
    evidence.teams,
    evidence.users,
    evidence.userIdentities,
    evidence.teamMembers,
    evidence.projects,
    evidence.servers,
    evidence.auditEntries,
    evidence.backupPolicies,
    evidence.backupRuns,
    evidence.orphanTeamMembers,
    evidence.orphanProjects,
    evidence.orphanServers
  ];
  const fingerprints = evidence.fingerprints && Object.values(evidence.fingerprints);
  if (
    counts.some((count) => !Number.isSafeInteger(count) || count < 0) ||
    evidence.users < 1 ||
    evidence.teams < 1 ||
    evidence.orphanTeamMembers !== 0 ||
    evidence.orphanProjects !== 0 ||
    evidence.orphanServers !== 0 ||
    !fingerprints ||
    fingerprints.length !== 8 ||
    fingerprints.some((entry) => typeof entry !== "string" || !SHA256.test(entry)) ||
    !isIdentityRows(evidence.projectsById, "teamId") ||
    evidence.projectsById.length !== evidence.projects ||
    !isIdentityRows(evidence.serversById, "teamId") ||
    evidence.serversById.length !== evidence.servers ||
    !isIdentityRows(evidence.backupPoliciesById, "teamId") ||
    evidence.backupPoliciesById.length !== evidence.backupPolicies ||
    !isIdentityRows(evidence.backupRunsById, "policyId") ||
    evidence.backupRunsById.length !== evidence.backupRuns ||
    !evidence.verificationPrincipal ||
    typeof evidence.verificationPrincipal.id !== "string" ||
    typeof evidence.verificationPrincipal.email !== "string" ||
    typeof evidence.verificationPrincipal.role !== "string" ||
    typeof evidence.verificationPrincipal.activeTeamId !== "string"
  ) {
    throw new Error("Restored database failed ownership and identity checks.");
  }
  return evidence;
}

export function assertRecoveryIdentityPreserved(
  restored: RecoveryDatabaseEvidence,
  restarted: RecoveryDatabaseEvidence
): void {
  const exactCounts = [
    "teams",
    "users",
    "userIdentities",
    "teamMembers",
    "projects",
    "auditEntries",
    "backupPolicies",
    "backupRuns"
  ] as const;
  const exactFingerprints = [
    "teams",
    "users",
    "userIdentities",
    "teamMembers",
    "projects",
    "auditEntries",
    "backupPolicies",
    "backupRuns"
  ] as const;
  const restoredServers = new Map(restored.serversById.map((server) => [server.id, server.teamId]));
  const restartedServers = new Map(
    restarted.serversById.map((server) => [server.id, server.teamId])
  );
  if (
    exactCounts.some((key) => restored[key] !== restarted[key]) ||
    exactFingerprints.some((key) => restored.fingerprints[key] !== restarted.fingerprints[key]) ||
    JSON.stringify(restored.projectsById) !== JSON.stringify(restarted.projectsById) ||
    JSON.stringify(restored.backupPoliciesById) !== JSON.stringify(restarted.backupPoliciesById) ||
    JSON.stringify(restored.backupRunsById) !== JSON.stringify(restarted.backupRunsById) ||
    restored.verificationPrincipal.id !== restarted.verificationPrincipal.id ||
    restored.verificationPrincipal.role !== restarted.verificationPrincipal.role ||
    restored.verificationPrincipal.activeTeamId !== restarted.verificationPrincipal.activeTeamId ||
    [...restoredServers].some(([id, teamId]) => restartedServers.get(id) !== teamId)
  ) {
    throw new Error(
      "Post-start recovery verification found changed or missing restored identities."
    );
  }
}
