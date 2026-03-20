export type ApiLane = "read" | "planning" | "command";
export type ApiAuth = "public" | "authenticated";

export interface ApiProcedureAccess {
  auth: ApiAuth;
  laneOverride?: ApiLane;
  requiredRoles: readonly string[];
  requiredScopes: readonly string[];
}

export interface ApiExample {
  id: string;
  category: "auth" | "deployment" | "env" | "backup" | "approval";
  procedure: string;
  request: {
    method: "GET" | "POST";
    path: string;
    input?: unknown;
  };
  response: unknown;
}

export type CliLane = "session" | "read" | "planning" | "command" | "local";

export interface CliCommandMeta {
  lane: CliLane;
  requiredScopes: readonly string[];
  mutating: boolean;
}

const ADMIN_ROLES = ["owner", "admin"] as const;
const WRITE_ROLES = ["owner", "admin", "operator", "developer"] as const;
const OPS_ROLES = ["owner", "admin", "operator"] as const;
const AGENT_WRITE_ROLES = ["owner", "admin", "operator", "developer", "agent"] as const;
const READ_ROLES = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

function addApiGroup(
  target: Record<string, ApiProcedureAccess>,
  names: readonly string[],
  access: ApiProcedureAccess
): void {
  for (const name of names) {
    target[name] = access;
  }
}

const apiProcedureAccess: Record<string, ApiProcedureAccess> = {};

addApiGroup(apiProcedureAccess, ["health", "platformOverview", "roadmap"], {
  auth: "public",
  requiredRoles: [],
  requiredScopes: []
});

addApiGroup(
  apiProcedureAccess,
  [
    "viewer",
    "recentDeployments",
    "composeReleaseCatalog",
    "composeDriftReport",
    "approvalQueue",
    "deploymentDetails",
    "executionQueue",
    "infrastructureInventory",
    "serverReadiness",
    "deploymentInsights",
    "deploymentRollbackPlans",
    "auditTrail",
    "environmentVariables",
    "deploymentLogs",
    "operationsTimeline",
    "projects",
    "projectDetails",
    "projectEnvironments",
    "projectServices",
    "services",
    "serviceDetails",
    "serviceDomainState",
    "agents",
    "gitProviders",
    "gitInstallations",
    "backupDestinations",
    "backupDestination",
    "backupMetrics",
    "backupDiagnosis",
    "listSecretProviders",
    "validateSecretRef",
    "listPushSubscriptions",
    "listChannels",
    "getUserPreferences",
    "getProjectOverrides",
    "listDeliveryLogs"
  ],
  {
    auth: "authenticated",
    requiredRoles: [],
    requiredScopes: []
  }
);

addApiGroup(
  apiProcedureAccess,
  [
    "subscribePush",
    "unsubscribePush",
    "createChannel",
    "deleteChannel",
    "updateChannel",
    "toggleChannel",
    "setUserPreference",
    "setProjectOverride"
  ],
  {
    auth: "authenticated",
    requiredRoles: [],
    requiredScopes: []
  }
);

addApiGroup(
  apiProcedureAccess,
  [
    "adminControlPlane",
    "agentTokenInventory",
    "principalInventory",
    "createAgent",
    "deleteProject",
    "deleteEnvironment",
    "deleteService",
    "registerGitProvider",
    "deleteGitProvider",
    "createGitInstallation",
    "exchangeGitLabCode",
    "createSecretProvider",
    "testSecretProvider",
    "deleteSecretProvider"
  ],
  {
    auth: "authenticated",
    requiredRoles: ADMIN_ROLES,
    requiredScopes: []
  }
);

addApiGroup(
  apiProcedureAccess,
  ["composePreviews", "composePreviewReconciliation", "rollbackTargets", "deploymentDiff"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["deploy:read"]
  }
);

addApiGroup(
  apiProcedureAccess,
  ["composeDeploymentPlan", "deploymentPlan", "rollbackPlan", "configDiff"],
  {
    auth: "authenticated",
    laneOverride: "planning",
    requiredRoles: READ_ROLES,
    requiredScopes: ["deploy:read"]
  }
);

addApiGroup(
  apiProcedureAccess,
  ["backupOverview", "backupRestoreQueue", "persistentVolumes", "backupRunDetails"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["backup:read"]
  }
);

addApiGroup(apiProcedureAccess, ["registerServer", "deleteServer"], {
  auth: "authenticated",
  requiredRoles: ADMIN_ROLES,
  requiredScopes: ["server:write"]
});

addApiGroup(
  apiProcedureAccess,
  [
    "createProject",
    "createEnvironment",
    "createDeploymentRecord",
    "queueComposeRelease",
    "dispatchExecutionJob",
    "completeExecutionJob",
    "failExecutionJob",
    "triggerDeploy",
    "reconcileComposePreviews"
  ],
  {
    auth: "authenticated",
    requiredRoles: WRITE_ROLES,
    requiredScopes: ["deploy:start"]
  }
);

addApiGroup(apiProcedureAccess, ["cancelDeployment"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["deploy:cancel"]
});

addApiGroup(apiProcedureAccess, ["executeRollback"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["deploy:rollback"]
});

addApiGroup(apiProcedureAccess, ["upsertEnvironmentVariable", "deleteEnvironmentVariable"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["env:write"]
});

addApiGroup(
  apiProcedureAccess,
  [
    "updateProject",
    "updateEnvironment",
    "createService",
    "updateService",
    "updateServiceRuntimeConfig",
    "addServiceDomain",
    "removeServiceDomain",
    "setPrimaryServiceDomain",
    "updateServicePortMappings"
  ],
  {
    auth: "authenticated",
    requiredRoles: WRITE_ROLES,
    requiredScopes: ["service:update"]
  }
);

apiProcedureAccess.resolveEnvironmentSecrets = {
  auth: "authenticated",
  requiredRoles: AGENT_WRITE_ROLES,
  requiredScopes: ["secrets:read"]
};

apiProcedureAccess.requestApproval = {
  auth: "authenticated",
  requiredRoles: AGENT_WRITE_ROLES,
  requiredScopes: ["approvals:create"]
};

addApiGroup(apiProcedureAccess, ["approveApprovalRequest", "rejectApprovalRequest"], {
  auth: "authenticated",
  requiredRoles: OPS_ROLES,
  requiredScopes: ["approvals:decide"]
});

addApiGroup(apiProcedureAccess, ["generateAgentToken", "revokeAgentToken"], {
  auth: "authenticated",
  requiredRoles: ADMIN_ROLES,
  requiredScopes: ["tokens:manage"]
});

addApiGroup(
  apiProcedureAccess,
  [
    "triggerBackupRun",
    "createBackupDestination",
    "updateBackupDestination",
    "deleteBackupDestination",
    "testBackupDestination",
    "listDestinationFiles",
    "enableBackupSchedule",
    "disableBackupSchedule",
    "triggerBackupNow"
  ],
  {
    auth: "authenticated",
    requiredRoles: OPS_ROLES,
    requiredScopes: ["backup:run"]
  }
);

addApiGroup(apiProcedureAccess, ["queueBackupRestore", "triggerTestRestore"], {
  auth: "authenticated",
  requiredRoles: OPS_ROLES,
  requiredScopes: ["backup:restore"]
});

export { apiProcedureAccess };

export const apiExamples: ApiExample[] = [
  {
    id: "auth.viewer",
    category: "auth",
    procedure: "viewer",
    request: { method: "GET", path: "/trpc/viewer" },
    response: {
      principal: {
        id: "usr_abc123",
        email: "owner@example.com",
        name: "Owner",
        type: "user",
        linkedUserId: "usr_abc123"
      },
      session: {
        id: "sess_abc123",
        expiresAt: "2026-03-20T18:00:00.000Z"
      },
      authz: {
        authMethod: "api-token",
        role: "admin",
        capabilities: ["deploy:read", "deploy:start", "service:update", "logs:read"],
        token: {
          id: "tok_abc123",
          name: "ci-deploy",
          prefix: "dfl_ci_abcd",
          expiresAt: "2026-06-01T00:00:00.000Z",
          scopes: ["deploy:read", "deploy:start", "service:update", "logs:read"]
        }
      }
    }
  },
  {
    id: "deployment.compose-plan",
    category: "deployment",
    procedure: "composeDeploymentPlan",
    request: {
      method: "GET",
      path: "/trpc/composeDeploymentPlan",
      input: {
        server: "srv_prod",
        compose: "services:\\n  web:\\n    image: ghcr.io/acme/web:main\\n",
        composePath: "./compose.yaml",
        contextPath: ".",
        localBuildContexts: [],
        requiresContextUpload: false
      }
    },
    response: {
      isReady: true,
      deploymentSource: "uploaded-compose",
      service: { id: null, name: "web", action: "create", sourceType: "compose" },
      target: { serverId: "srv_prod", serverName: "prod-us-west", serverHost: "10.0.0.42" },
      steps: [
        "Freeze the compose file",
        "Dispatch the staged workspace",
        "Run docker compose up -d"
      ]
    }
  },
  {
    id: "deployment.trigger-deploy",
    category: "deployment",
    procedure: "triggerDeploy",
    request: {
      method: "POST",
      path: "/trpc/triggerDeploy",
      input: { serviceId: "svc_my_api", imageTag: "ghcr.io/acme/api:1.4.2" }
    },
    response: {
      id: "dep_abc123",
      serviceName: "api",
      status: "queued",
      createdAt: "2026-03-20T12:00:00.000Z"
    }
  },
  {
    id: "env.upsert",
    category: "env",
    procedure: "upsertEnvironmentVariable",
    request: {
      method: "POST",
      path: "/trpc/upsertEnvironmentVariable",
      input: {
        environmentId: "env_prod",
        key: "DATABASE_URL",
        value: "postgresql://app:secret@db:5432/app",
        isSecret: true,
        category: "runtime",
        source: "inline"
      }
    },
    response: {
      id: "envvar_abc123",
      environmentId: "env_prod",
      key: "DATABASE_URL",
      isSecret: true,
      category: "runtime"
    }
  },
  {
    id: "backup.run",
    category: "backup",
    procedure: "triggerBackupNow",
    request: {
      method: "POST",
      path: "/trpc/triggerBackupNow",
      input: { policyId: "bkp_pol_123" }
    },
    response: {
      id: "bkp_run_123",
      status: "queued",
      triggerKind: "manual",
      createdAt: "2026-03-20T12:05:00.000Z"
    }
  },
  {
    id: "backup.restore",
    category: "backup",
    procedure: "queueBackupRestore",
    request: {
      method: "POST",
      path: "/trpc/queueBackupRestore",
      input: { backupRunId: "bkp_run_123" }
    },
    response: {
      id: "rst_abc123",
      backupRunId: "bkp_run_123",
      status: "queued"
    }
  },
  {
    id: "approval.request",
    category: "approval",
    procedure: "requestApproval",
    request: {
      method: "POST",
      path: "/trpc/requestApproval",
      input: {
        actionType: "compose-release",
        composeServiceId: "svc_my_api",
        commitSha: "abcdef1",
        imageTag: "ghcr.io/acme/api:1.4.2",
        reason: "Production deploy approved by release checklist."
      }
    },
    response: {
      id: "apr_abc123",
      status: "pending"
    }
  },
  {
    id: "approval.approve",
    category: "approval",
    procedure: "approveApprovalRequest",
    request: {
      method: "POST",
      path: "/trpc/approveApprovalRequest",
      input: { requestId: "apr_abc123" }
    },
    response: {
      id: "apr_abc123",
      status: "approved"
    }
  }
];

export const cliCommandMeta: Record<string, CliCommandMeta> = {
  login: { lane: "session", requiredScopes: [], mutating: true },
  services: { lane: "read", requiredScopes: ["service:read"], mutating: false },
  deploy: { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
  push: { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
  "env list": { lane: "read", requiredScopes: ["env:read"], mutating: false },
  "env pull": { lane: "read", requiredScopes: ["env:read"], mutating: false },
  "env push": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env set": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env delete": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env resolve": { lane: "read", requiredScopes: ["secrets:read"], mutating: false },
  logs: { lane: "read", requiredScopes: ["logs:read"], mutating: false },
  plan: { lane: "planning", requiredScopes: ["deploy:read"], mutating: false },
  rollback: { lane: "command", requiredScopes: ["deploy:rollback"], mutating: true },
  status: { lane: "read", requiredScopes: ["server:read"], mutating: false },
  projects: { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "projects list": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  doctor: { lane: "read", requiredScopes: ["server:read", "logs:read"], mutating: false },
  whoami: { lane: "read", requiredScopes: [], mutating: false },
  capabilities: { lane: "read", requiredScopes: [], mutating: false },
  install: { lane: "local", requiredScopes: [], mutating: true },
  upgrade: { lane: "local", requiredScopes: [], mutating: true },
  uninstall: { lane: "local", requiredScopes: [], mutating: true },
  "backup list": { lane: "read", requiredScopes: ["backup:read"], mutating: false },
  "backup destinations": { lane: "read", requiredScopes: ["backup:read"], mutating: false },
  "backup run": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "backup restore": {
    lane: "command",
    requiredScopes: ["backup:restore", "approvals:create"],
    mutating: true
  },
  "backup verify": { lane: "command", requiredScopes: ["backup:restore"], mutating: true },
  "backup download": { lane: "read", requiredScopes: ["backup:read"], mutating: false },
  "backup destination add": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "backup destination delete": {
    lane: "command",
    requiredScopes: ["backup:run"],
    mutating: true
  },
  "backup destination test": {
    lane: "command",
    requiredScopes: ["backup:run"],
    mutating: true
  },
  "backup schedule enable": {
    lane: "command",
    requiredScopes: ["backup:run"],
    mutating: true
  },
  "backup schedule disable": {
    lane: "command",
    requiredScopes: ["backup:run"],
    mutating: true
  },
  "token presets": { lane: "local", requiredScopes: [], mutating: false },
  "token create": { lane: "command", requiredScopes: ["tokens:manage"], mutating: true },
  "token list": { lane: "read", requiredScopes: ["tokens:manage"], mutating: false },
  "token revoke": { lane: "command", requiredScopes: ["tokens:manage"], mutating: true },
  diff: { lane: "planning", requiredScopes: ["deploy:read"], mutating: false },
  cancel: { lane: "command", requiredScopes: ["deploy:cancel"], mutating: true },
  update: { lane: "local", requiredScopes: [], mutating: true },
  "config generate-vapid": { lane: "local", requiredScopes: [], mutating: false }
};

export const cliExamples = [
  {
    id: "auth.whoami",
    category: "auth",
    command: "daoflow whoami --json",
    response: {
      ok: true,
      data: {
        principal: { id: "usr_abc123", email: "owner@example.com", name: "Owner", type: "user" },
        role: "admin",
        scopes: ["deploy:read", "deploy:start", "logs:read"],
        authMethod: "api-token",
        token: {
          id: "tok_abc123",
          name: "ci-deploy",
          prefix: "dfl_ci_abcd",
          expiresAt: "2026-06-01T00:00:00.000Z",
          scopes: ["deploy:read", "deploy:start", "logs:read"]
        },
        session: null
      }
    }
  },
  {
    id: "deployment.deploy-dry-run",
    category: "deployment",
    command: "daoflow deploy --service svc_my_api --dry-run --json",
    response: {
      ok: true,
      data: {
        dryRun: true,
        plan: { isReady: true, executeCommand: "daoflow deploy --service svc_my_api --yes" }
      }
    }
  },
  {
    id: "env.set-confirmation",
    category: "env",
    command: "daoflow env set --env-id env_prod --key API_URL --value https://example.com --json",
    response: {
      ok: false,
      error: "Set API_URL in environment env_prod. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    }
  },
  {
    id: "backup.run-dry-run",
    category: "backup",
    command: "daoflow backup run --policy pol_123 --dry-run --json",
    response: {
      ok: true,
      data: {
        dryRun: true,
        action: "backup.run",
        policyId: "pol_123",
        message: "Would trigger one-off backup for policy pol_123"
      }
    }
  },
  {
    id: "backup.restore-confirmation",
    category: "backup",
    command: "daoflow backup restore --backup-run-id bkr_123 --json",
    response: {
      ok: false,
      error: "To restore from backup bkr_123, add --yes",
      code: "CONFIRMATION_REQUIRED"
    }
  }
] as const;
