import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { pool, reinitializeDatabaseConnection } from "./db/connection";
import {
  ensureControlPlaneReady,
  resetControlPlaneSeedState,
  waitForControlPlaneSeedIdle
} from "./db/services/seed";
import {
  ensureDatabaseExists,
  resetDatabaseSchema,
  truncateDatabaseTables
} from "./db/reset-database";
import { resolveTestDatabaseUrl } from "./db/test-database-url";
import {
  resetInitialOwnerBootstrapState,
  waitForInitialOwnerBootstrapIdle
} from "./bootstrap-initial-owner";
import {
  resetLocalhostServerBootstrapState,
  waitForLocalhostServerBootstrapIdle
} from "./bootstrap-localhost-server";
import { resetAuthState } from "./auth";

const { Client } = pg;
const TEST_DB_PREPARE_LOCK_ID = 8_705_231;
const MIN_EXPECTED_PUBLIC_TABLES = 48;

let prepared = false;
let preparePromise: Promise<string> | null = null;

async function applyMigrations(connectionString: string) {
  const migrationDir = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    "../../../drizzle"
  );
  const migrationFiles = (await readdir(migrationDir))
    .filter((file) => file.endsWith(".sql"))
    .sort((a, b) => a.localeCompare(b));

  await resetDatabaseSchema(connectionString);
  const client = new Client({ connectionString });
  await client.connect();
  try {
    for (const file of migrationFiles) {
      const sql = await readFile(path.join(migrationDir, file), "utf8");
      const statements = sql
        .split("--> statement-breakpoint")
        .map((statement) => statement.trim())
        .filter(Boolean);

      for (const statement of statements) {
        await client.query(statement);
      }
    }
  } finally {
    await client.end();
  }
}

async function withTestDatabaseLock<T>(
  connectionString: string,
  callback: () => Promise<T>
): Promise<T> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    await client.query("SELECT pg_advisory_lock($1)", [TEST_DB_PREPARE_LOCK_ID]);
    return await callback();
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock($1)", [TEST_DB_PREPARE_LOCK_ID]);
    } finally {
      await client.end();
    }
  }
}

async function isTestSchemaReady(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{
      tableCount: number;
      users: string | null;
      teams: string | null;
      backupDestinationsTeamId: string | null;
      backupRunsArtifactCheckedAt: string | null;
      backupRestoresMode: string | null;
      controlPlaneRecoveryBundles: string | null;
      backupDestinationsCredentialsEncrypted: string | null;
      backupDestinationsCredentialStateCheck: string | null;
      containerRegistriesTeamId: string | null;
      backupDestinationsTeamIndex: string | null;
      containerRegistriesTeamIndex: string | null;
      containerRegistriesNameTeamIndex: string | null;
      containerRegistriesHostTeamIndex: string | null;
      projects: string | null;
      environments: string | null;
      services: string | null;
      serviceSchedules: string | null;
      serviceScheduleRuns: string | null;
      previewEnvironments: string | null;
      deployments: string | null;
      deploymentBuildLeases: string | null;
      deploymentQueueReservations: string | null;
      deploymentBuildLeaseOwnerToken: string | null;
      serviceVariables: string | null;
      gitProviders: string | null;
      providerFeedback: string | null;
      providerFeedbackSequence: string | null;
      providerFeedbackTargets: string | null;
      gitProviderSetupStates: string | null;
      gitProvidersTeamId: string | null;
      gitInstallationsTeamId: string | null;
      repositoryCredentials: string | null;
      cliAuthRequests: string | null;
      developmentTasks: string | null;
      serverOperations: string | null;
      serversTeamId: string | null;
      serversMaxConcurrentBuilds: string | null;
      serversMaxQueuedDeployments: string | null;
      logDrains: string | null;
      logDrainsTeamId: string | null;
      managedSshKeys: string | null;
      sshHostIdentities: string | null;
      certificateAssets: string | null;
      certificateAssetsIssuer: string | null;
      approvalRequestsRequestedByRole: string | null;
      approvalRequestsInputSummary: string | null;
      approvalRequestsTeamId: string | null;
      requestAccessLogs: string | null;
      accountSecurityPolicies: string | null;
      twoFactor: string | null;
      usersTwoFactorEnabled: string | null;
      usersMfaEnrolledAt: string | null;
      apiTokensLastUsedIp: string | null;
      apiTokensLastUsedUserAgent: string | null;
      apiTokensLastFailureAt: string | null;
      apiTokensLastFailureCode: string | null;
      apiTokensLastFailureIp: string | null;
      projectsPreviewPolicy: string | null;
      projectsPreviewPolicyRevision: string | null;
      auditEntriesImmutableGuard: string | null;
      auditCommandAcceptanceIndex: string | null;
      approvalRequestsBindingKey: string | null;
      approvalActionDispatches: string | null;
      servicesExecutionScopeGuard: string | null;
      environmentsExecutionScopeGuard: string | null;
      deploymentsExecutionScopeGuard: string | null;
      gitProviderSetupScopeConstraint: string | null;
    }>(`
      SELECT
        (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS "tableCount",
        to_regclass('public.users') AS "users",
        to_regclass('public.teams') AS "teams",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_destinations' AND column_name = 'team_id') AS "backupDestinationsTeamId",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_runs' AND column_name = 'artifact_checked_at') AS "backupRunsArtifactCheckedAt",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_restores' AND column_name = 'mode') AS "backupRestoresMode",
        to_regclass('public.control_plane_recovery_bundles') AS "controlPlaneRecoveryBundles",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_destinations' AND column_name = 'credentials_encrypted') AS "backupDestinationsCredentialsEncrypted",
        (SELECT conname FROM pg_constraint WHERE conname = 'backup_destinations_credentials_state_check') AS "backupDestinationsCredentialStateCheck",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'container_registries' AND column_name = 'team_id') AS "containerRegistriesTeamId",
        (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'backup_destinations_team_id_idx') AS "backupDestinationsTeamIndex",
        (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_team_id_idx') AS "containerRegistriesTeamIndex",
        (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_name_team_idx') AS "containerRegistriesNameTeamIndex",
        (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_host_team_idx') AS "containerRegistriesHostTeamIndex",
        to_regclass('public.projects') AS "projects",
        to_regclass('public.environments') AS "environments",
        to_regclass('public.services') AS "services",
        to_regclass('public.service_schedules') AS "serviceSchedules",
        to_regclass('public.service_schedule_runs') AS "serviceScheduleRuns",
        to_regclass('public.preview_environments') AS "previewEnvironments",
        to_regclass('public.deployments') AS "deployments",
        to_regclass('public.deployment_build_leases') AS "deploymentBuildLeases",
        to_regclass('public.deployment_queue_reservations') AS "deploymentQueueReservations",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deployment_build_leases' AND column_name = 'owner_token') AS "deploymentBuildLeaseOwnerToken",
        to_regclass('public.service_variables') AS "serviceVariables",
        to_regclass('public.git_providers') AS "gitProviders",
        to_regclass('public.provider_feedback') AS "providerFeedback",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_feedback' AND column_name = 'sequence') AS "providerFeedbackSequence",
        to_regclass('public.provider_feedback_targets') AS "providerFeedbackTargets",
        to_regclass('public.git_provider_setup_states') AS "gitProviderSetupStates",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'git_providers' AND column_name = 'team_id') AS "gitProvidersTeamId",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'git_installations' AND column_name = 'team_id') AS "gitInstallationsTeamId",
        to_regclass('public.repository_credentials') AS "repositoryCredentials",
        to_regclass('public.cli_auth_requests') AS "cliAuthRequests",
        to_regclass('public.development_tasks') AS "developmentTasks"
        ,to_regclass('public.server_operations') AS "serverOperations",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'team_id') AS "serversTeamId",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'max_concurrent_builds') AS "serversMaxConcurrentBuilds",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'max_queued_deployments') AS "serversMaxQueuedDeployments",
        to_regclass('public.log_drains') AS "logDrains",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'log_drains' AND column_name = 'team_id') AS "logDrainsTeamId",
        to_regclass('public.managed_ssh_keys') AS "managedSshKeys",
        to_regclass('public.ssh_host_identities') AS "sshHostIdentities",
        to_regclass('public.certificate_assets') AS "certificateAssets",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'certificate_assets' AND column_name = 'issuer') AS "certificateAssetsIssuer",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'requested_by_role') AS "approvalRequestsRequestedByRole",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'input_summary') AS "approvalRequestsInputSummary",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'team_id' AND is_nullable = 'NO') AS "approvalRequestsTeamId",
        to_regclass('public.request_access_logs') AS "requestAccessLogs",
        to_regclass('public.account_security_policies') AS "accountSecurityPolicies",
        to_regclass('public.two_factor') AS "twoFactor",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'two_factor_enabled') AS "usersTwoFactorEnabled",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'mfa_enrolled_at') AS "usersMfaEnrolledAt",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_used_ip') AS "apiTokensLastUsedIp",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_used_user_agent') AS "apiTokensLastUsedUserAgent",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_at') AS "apiTokensLastFailureAt",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_code') AS "apiTokensLastFailureCode",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_ip') AS "apiTokensLastFailureIp",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'preview_policy') AS "projectsPreviewPolicy",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'preview_policy_revision') AS "projectsPreviewPolicyRevision",
        (SELECT tgname FROM pg_trigger WHERE tgname = 'audit_entries_immutable_guard' AND NOT tgisinternal) AS "auditEntriesImmutableGuard",
        (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_command_acceptance_attempt_unique') AS "auditCommandAcceptanceIndex",
        (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'binding_key') AS "approvalRequestsBindingKey",
        to_regclass('public.approval_action_dispatches') AS "approvalActionDispatches",
        (SELECT tgname FROM pg_trigger WHERE tgname = 'services_execution_scope_guard' AND NOT tgisinternal) AS "servicesExecutionScopeGuard",
        (SELECT tgname FROM pg_trigger WHERE tgname = 'environments_execution_scope_guard' AND NOT tgisinternal) AS "environmentsExecutionScopeGuard",
        (SELECT tgname FROM pg_trigger WHERE tgname = 'deployments_execution_scope_guard' AND NOT tgisinternal) AS "deploymentsExecutionScopeGuard",
        (SELECT conname FROM pg_constraint WHERE conname = 'git_provider_setup_states_provider_id_team_id_git_providers_id_team_id_fk') AS "gitProviderSetupScopeConstraint"
    `);
    const row = result.rows[0];
    return Boolean(
      row?.tableCount &&
      row.tableCount >= MIN_EXPECTED_PUBLIC_TABLES &&
      row.users &&
      row.teams &&
      row.backupDestinationsTeamId &&
      row.backupRunsArtifactCheckedAt &&
      row.backupRestoresMode &&
      row.controlPlaneRecoveryBundles &&
      row.backupDestinationsCredentialsEncrypted &&
      row.backupDestinationsCredentialStateCheck &&
      row.containerRegistriesTeamId &&
      row.backupDestinationsTeamIndex &&
      row.containerRegistriesTeamIndex &&
      row.containerRegistriesNameTeamIndex &&
      row.containerRegistriesHostTeamIndex &&
      row.projects &&
      row.environments &&
      row.services &&
      row.serviceSchedules &&
      row.serviceScheduleRuns &&
      row.previewEnvironments &&
      row.deployments &&
      row.deploymentBuildLeases &&
      row.deploymentQueueReservations &&
      row.deploymentBuildLeaseOwnerToken &&
      row.serviceVariables &&
      row.gitProviders &&
      row.providerFeedback &&
      row.providerFeedbackSequence &&
      row.providerFeedbackTargets &&
      row.gitProviderSetupStates &&
      row.gitProvidersTeamId &&
      row.gitInstallationsTeamId &&
      row.repositoryCredentials &&
      row.cliAuthRequests &&
      row.developmentTasks &&
      row.serverOperations &&
      row.serversTeamId &&
      row.serversMaxConcurrentBuilds &&
      row.serversMaxQueuedDeployments &&
      row.logDrains &&
      row.logDrainsTeamId &&
      row.managedSshKeys &&
      row.sshHostIdentities &&
      row.certificateAssets &&
      row.certificateAssetsIssuer &&
      row.approvalRequestsRequestedByRole &&
      row.approvalRequestsInputSummary &&
      row.approvalRequestsTeamId &&
      row.requestAccessLogs &&
      row.accountSecurityPolicies &&
      row.twoFactor &&
      row.usersTwoFactorEnabled &&
      row.usersMfaEnrolledAt &&
      row.apiTokensLastUsedIp &&
      row.apiTokensLastUsedUserAgent &&
      row.apiTokensLastFailureAt &&
      row.apiTokensLastFailureCode &&
      row.apiTokensLastFailureIp &&
      row.projectsPreviewPolicy &&
      row.projectsPreviewPolicyRevision &&
      row.auditEntriesImmutableGuard &&
      row.auditCommandAcceptanceIndex &&
      row.approvalRequestsBindingKey &&
      row.approvalActionDispatches &&
      row.servicesExecutionScopeGuard &&
      row.environmentsExecutionScopeGuard &&
      row.deploymentsExecutionScopeGuard &&
      row.gitProviderSetupScopeConstraint
    );
  } finally {
    await client.end();
  }
}

async function isControlPlaneSeedReady(connectionString: string): Promise<boolean> {
  const client = new Client({ connectionString });
  await client.connect();

  try {
    const result = await client.query<{
      hasUser: boolean;
      hasTeam: boolean;
      hasServer: boolean;
    }>(`
      SELECT
        EXISTS (SELECT 1 FROM public.users WHERE id = 'user_foundation_owner') AS "hasUser",
        EXISTS (SELECT 1 FROM public.teams WHERE id = 'team_foundation') AS "hasTeam",
        EXISTS (SELECT 1 FROM public.servers WHERE id = 'srv_foundation_1') AS "hasServer"
    `);
    const row = result.rows[0];
    return Boolean(row?.hasUser && row.hasTeam && row.hasServer);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "42P01") {
      return false;
    }

    throw error;
  } finally {
    await client.end();
  }
}

async function readPoolSchemaState() {
  const result = await pool.query<{
    databaseName: string;
    tableCount: number;
    users: string | null;
    teams: string | null;
    backupDestinationsTeamId: string | null;
    backupRunsArtifactCheckedAt: string | null;
    backupRestoresMode: string | null;
    controlPlaneRecoveryBundles: string | null;
    backupDestinationsCredentialsEncrypted: string | null;
    backupDestinationsCredentialStateCheck: string | null;
    containerRegistriesTeamId: string | null;
    backupDestinationsTeamIndex: string | null;
    containerRegistriesTeamIndex: string | null;
    containerRegistriesNameTeamIndex: string | null;
    containerRegistriesHostTeamIndex: string | null;
    projects: string | null;
    environments: string | null;
    services: string | null;
    serviceSchedules: string | null;
    serviceScheduleRuns: string | null;
    previewEnvironments: string | null;
    deployments: string | null;
    deploymentBuildLeases: string | null;
    deploymentQueueReservations: string | null;
    deploymentBuildLeaseOwnerToken: string | null;
    serviceVariables: string | null;
    gitProviders: string | null;
    providerFeedback: string | null;
    providerFeedbackSequence: string | null;
    providerFeedbackTargets: string | null;
    gitProviderSetupStates: string | null;
    gitProvidersTeamId: string | null;
    gitInstallationsTeamId: string | null;
    repositoryCredentials: string | null;
    cliAuthRequests: string | null;
    developmentTasks: string | null;
    serverOperations: string | null;
    serversTeamId: string | null;
    serversMaxConcurrentBuilds: string | null;
    serversMaxQueuedDeployments: string | null;
    logDrains: string | null;
    logDrainsTeamId: string | null;
    managedSshKeys: string | null;
    sshHostIdentities: string | null;
    approvalRequestsRequestedByRole: string | null;
    approvalRequestsInputSummary: string | null;
    approvalRequestsTeamId: string | null;
    requestAccessLogs: string | null;
    accountSecurityPolicies: string | null;
    twoFactor: string | null;
    usersTwoFactorEnabled: string | null;
    usersMfaEnrolledAt: string | null;
    apiTokensLastUsedIp: string | null;
    apiTokensLastUsedUserAgent: string | null;
    apiTokensLastFailureAt: string | null;
    apiTokensLastFailureCode: string | null;
    apiTokensLastFailureIp: string | null;
    projectsPreviewPolicy: string | null;
    projectsPreviewPolicyRevision: string | null;
    auditEntriesImmutableGuard: string | null;
    auditCommandAcceptanceIndex: string | null;
    approvalRequestsBindingKey: string | null;
    approvalActionDispatches: string | null;
    servicesExecutionScopeGuard: string | null;
    environmentsExecutionScopeGuard: string | null;
    deploymentsExecutionScopeGuard: string | null;
    gitProviderSetupScopeConstraint: string | null;
  }>(`
    SELECT
      current_database() AS "databaseName",
      (SELECT count(*)::int FROM pg_tables WHERE schemaname = 'public') AS "tableCount",
      to_regclass('public.users') AS "users",
      to_regclass('public.teams') AS "teams",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_destinations' AND column_name = 'team_id') AS "backupDestinationsTeamId",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_runs' AND column_name = 'artifact_checked_at') AS "backupRunsArtifactCheckedAt",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_restores' AND column_name = 'mode') AS "backupRestoresMode",
      to_regclass('public.control_plane_recovery_bundles') AS "controlPlaneRecoveryBundles",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'backup_destinations' AND column_name = 'credentials_encrypted') AS "backupDestinationsCredentialsEncrypted",
      (SELECT conname FROM pg_constraint WHERE conname = 'backup_destinations_credentials_state_check') AS "backupDestinationsCredentialStateCheck",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'container_registries' AND column_name = 'team_id') AS "containerRegistriesTeamId",
      (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'backup_destinations_team_id_idx') AS "backupDestinationsTeamIndex",
      (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_team_id_idx') AS "containerRegistriesTeamIndex",
      (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_name_team_idx') AS "containerRegistriesNameTeamIndex",
      (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'container_registries_host_team_idx') AS "containerRegistriesHostTeamIndex",
      to_regclass('public.projects') AS "projects",
      to_regclass('public.environments') AS "environments",
      to_regclass('public.services') AS "services",
      to_regclass('public.service_schedules') AS "serviceSchedules",
      to_regclass('public.service_schedule_runs') AS "serviceScheduleRuns",
      to_regclass('public.preview_environments') AS "previewEnvironments",
      to_regclass('public.deployments') AS "deployments",
      to_regclass('public.deployment_build_leases') AS "deploymentBuildLeases",
      to_regclass('public.deployment_queue_reservations') AS "deploymentQueueReservations",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'deployment_build_leases' AND column_name = 'owner_token') AS "deploymentBuildLeaseOwnerToken",
      to_regclass('public.service_variables') AS "serviceVariables",
      to_regclass('public.git_providers') AS "gitProviders",
      to_regclass('public.provider_feedback') AS "providerFeedback",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_feedback' AND column_name = 'sequence') AS "providerFeedbackSequence",
      to_regclass('public.provider_feedback_targets') AS "providerFeedbackTargets",
      to_regclass('public.git_provider_setup_states') AS "gitProviderSetupStates",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'git_providers' AND column_name = 'team_id') AS "gitProvidersTeamId",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'git_installations' AND column_name = 'team_id') AS "gitInstallationsTeamId",
      to_regclass('public.repository_credentials') AS "repositoryCredentials",
      to_regclass('public.cli_auth_requests') AS "cliAuthRequests",
      to_regclass('public.development_tasks') AS "developmentTasks"
      ,to_regclass('public.server_operations') AS "serverOperations",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'team_id') AS "serversTeamId",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'max_concurrent_builds') AS "serversMaxConcurrentBuilds",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'servers' AND column_name = 'max_queued_deployments') AS "serversMaxQueuedDeployments",
      to_regclass('public.log_drains') AS "logDrains",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'log_drains' AND column_name = 'team_id') AS "logDrainsTeamId",
      to_regclass('public.managed_ssh_keys') AS "managedSshKeys",
      to_regclass('public.ssh_host_identities') AS "sshHostIdentities",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'requested_by_role') AS "approvalRequestsRequestedByRole",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'input_summary') AS "approvalRequestsInputSummary",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'team_id' AND is_nullable = 'NO') AS "approvalRequestsTeamId",
      to_regclass('public.request_access_logs') AS "requestAccessLogs",
      to_regclass('public.account_security_policies') AS "accountSecurityPolicies",
      to_regclass('public.two_factor') AS "twoFactor",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'two_factor_enabled') AS "usersTwoFactorEnabled",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'mfa_enrolled_at') AS "usersMfaEnrolledAt",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_used_ip') AS "apiTokensLastUsedIp",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_used_user_agent') AS "apiTokensLastUsedUserAgent",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_at') AS "apiTokensLastFailureAt",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_code') AS "apiTokensLastFailureCode",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'api_tokens' AND column_name = 'last_failure_ip') AS "apiTokensLastFailureIp",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'preview_policy') AS "projectsPreviewPolicy",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'projects' AND column_name = 'preview_policy_revision') AS "projectsPreviewPolicyRevision",
      (SELECT tgname FROM pg_trigger WHERE tgname = 'audit_entries_immutable_guard' AND NOT tgisinternal) AS "auditEntriesImmutableGuard",
      (SELECT indexname FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'audit_command_acceptance_attempt_unique') AS "auditCommandAcceptanceIndex",
      (SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'approval_requests' AND column_name = 'binding_key') AS "approvalRequestsBindingKey",
      to_regclass('public.approval_action_dispatches') AS "approvalActionDispatches",
      (SELECT tgname FROM pg_trigger WHERE tgname = 'services_execution_scope_guard' AND NOT tgisinternal) AS "servicesExecutionScopeGuard",
      (SELECT tgname FROM pg_trigger WHERE tgname = 'environments_execution_scope_guard' AND NOT tgisinternal) AS "environmentsExecutionScopeGuard",
      (SELECT tgname FROM pg_trigger WHERE tgname = 'deployments_execution_scope_guard' AND NOT tgisinternal) AS "deploymentsExecutionScopeGuard",
      (SELECT conname FROM pg_constraint WHERE conname = 'git_provider_setup_states_provider_id_team_id_git_providers_id_team_id_fk') AS "gitProviderSetupScopeConstraint"
  `);

  return result.rows[0];
}

function readDatabaseName(connectionString: string) {
  return new URL(connectionString).pathname.replace(/^\//, "") || "daoflow_test";
}

async function ensurePooledTestSchemaReady(connectionString: string) {
  const expectedDatabaseName = readDatabaseName(connectionString);

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const state = await readPoolSchemaState();
      if (
        state?.databaseName === expectedDatabaseName &&
        state.tableCount >= MIN_EXPECTED_PUBLIC_TABLES &&
        state.users &&
        state.teams &&
        state.backupDestinationsTeamId &&
        state.backupRunsArtifactCheckedAt &&
        state.backupRestoresMode &&
        state.controlPlaneRecoveryBundles &&
        state.backupDestinationsCredentialsEncrypted &&
        state.backupDestinationsCredentialStateCheck &&
        state.containerRegistriesTeamId &&
        state.backupDestinationsTeamIndex &&
        state.containerRegistriesTeamIndex &&
        state.containerRegistriesNameTeamIndex &&
        state.containerRegistriesHostTeamIndex &&
        state.projects &&
        state.environments &&
        state.services &&
        state.serviceSchedules &&
        state.serviceScheduleRuns &&
        state.previewEnvironments &&
        state.deployments &&
        state.deploymentBuildLeases &&
        state.deploymentQueueReservations &&
        state.deploymentBuildLeaseOwnerToken &&
        state.serviceVariables &&
        state.gitProviders &&
        state.providerFeedback &&
        state.providerFeedbackSequence &&
        state.providerFeedbackTargets &&
        state.gitProviderSetupStates &&
        state.gitProvidersTeamId &&
        state.gitInstallationsTeamId &&
        state.repositoryCredentials &&
        state.cliAuthRequests &&
        state.developmentTasks &&
        state.serverOperations &&
        state.serversTeamId &&
        state.serversMaxConcurrentBuilds &&
        state.serversMaxQueuedDeployments &&
        state.logDrains &&
        state.logDrainsTeamId &&
        state.managedSshKeys &&
        state.sshHostIdentities &&
        state.approvalRequestsRequestedByRole &&
        state.approvalRequestsInputSummary &&
        state.approvalRequestsTeamId &&
        state.requestAccessLogs &&
        state.accountSecurityPolicies &&
        state.twoFactor &&
        state.usersTwoFactorEnabled &&
        state.usersMfaEnrolledAt &&
        state.apiTokensLastUsedIp &&
        state.apiTokensLastUsedUserAgent &&
        state.apiTokensLastFailureAt &&
        state.apiTokensLastFailureCode &&
        state.apiTokensLastFailureIp &&
        state.projectsPreviewPolicy &&
        state.projectsPreviewPolicyRevision &&
        state.auditEntriesImmutableGuard &&
        state.auditCommandAcceptanceIndex &&
        state.approvalRequestsBindingKey &&
        state.approvalActionDispatches &&
        state.servicesExecutionScopeGuard &&
        state.environmentsExecutionScopeGuard &&
        state.deploymentsExecutionScopeGuard &&
        state.gitProviderSetupScopeConstraint
      ) {
        return;
      }
    } catch {
      // Force a pool reconnect below and retry once.
    }

    await reinitializeDatabaseConnection({ connectionString, force: true });
  }

  throw new Error(
    `Test database pool is not ready for ${expectedDatabaseName} after schema reset.`
  );
}

export async function ensureTestDatabaseReady() {
  const connectionString = resolveTestDatabaseUrl();
  process.env.DATABASE_URL = connectionString;
  await reinitializeDatabaseConnection({ connectionString });

  if (prepared && (await isTestSchemaReady(connectionString))) {
    return connectionString;
  }

  if (!preparePromise) {
    preparePromise = (async () => {
      await ensureDatabaseExists(connectionString);
      await withTestDatabaseLock(connectionString, async () => {
        if (!(await isTestSchemaReady(connectionString))) {
          await applyMigrations(connectionString);
        }
      });
      await reinitializeDatabaseConnection({ connectionString, force: true });
      await ensurePooledTestSchemaReady(connectionString);
      prepared = true;
      return connectionString;
    })().finally(() => {
      preparePromise = null;
    });
  }

  await preparePromise;

  return connectionString;
}

export async function resetTestDatabase() {
  const connectionString = await ensureTestDatabaseReady();
  await waitForControlPlaneSeedIdle();
  await waitForInitialOwnerBootstrapIdle();
  await waitForLocalhostServerBootstrapIdle();
  resetControlPlaneSeedState();
  resetInitialOwnerBootstrapState();
  resetLocalhostServerBootstrapState();
  resetAuthState();
  await withTestDatabaseLock(connectionString, async () => {
    if (await isTestSchemaReady(connectionString)) {
      await truncateDatabaseTables(connectionString);
      return;
    }

    await applyMigrations(connectionString);
  });
  await reinitializeDatabaseConnection({ connectionString, force: true });
  await ensurePooledTestSchemaReady(connectionString);
}

export async function resetTestDatabaseWithControlPlane() {
  const connectionString = await ensureTestDatabaseReady();

  await resetTestDatabase();

  await withTestDatabaseLock(connectionString, async () => {
    let seeded = false;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      resetControlPlaneSeedState();
      await ensureControlPlaneReady();
      if (await isControlPlaneSeedReady(connectionString)) {
        seeded = true;
        break;
      }
    }

    if (!seeded) {
      throw new Error("Control-plane seed did not become ready after resetting the test database.");
    }
  });
}

export async function resetSeededTestDatabase() {
  await resetTestDatabaseWithControlPlane();
}
