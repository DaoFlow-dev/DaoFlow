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
    "approvalQueue",
    "deploymentDetails",
    "executionQueue",
    "infrastructureInventory",
    "serverReadiness",
    "serverOperationsHub",
    "serverOperationLogs",
    "deploymentInsights",
    "deploymentRollbackPlans",
    "auditTrail",
    "eventTimeline",
    "accountSecurityStatus",
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

apiProcedureAccess.accessLogs = {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["logs:read"]
};

apiProcedureAccess.serviceLoggingState = {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["diagnostics:read"]
};

apiProcedureAccess.previewServiceLoggingConfig = {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["deploy:read"]
};

addApiGroup(
  apiProcedureAccess,
  ["serverMetrics", "serverMetricsOverview", "serverMetricMonitoring"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["server:read"]
  }
);

addApiGroup(
  apiProcedureAccess,
  ["managedDatabaseCatalog", "managedDatabases", "providerFeedback", "webhookDeliveries"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["deploy:read"]
  }
);

addApiGroup(apiProcedureAccess, ["serviceSchedules", "serviceScheduleRuns"], {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["service:read"]
});

addApiGroup(
  apiProcedureAccess,
  ["developmentTasks", "developmentTaskDetails", "sandboxRunnerProfiles"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["deploy:read"]
  }
);

addApiGroup(apiProcedureAccess, ["developmentTaskStatuses"], {
  auth: "authenticated",
  requiredRoles: [],
  requiredScopes: []
});

addApiGroup(
  apiProcedureAccess,
  [
    "subscribePush",
    "unsubscribePush",
    "createChannel",
    "deleteChannel",
    "updateChannel",
    "toggleChannel",
    "testChannel",
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
    "createAgent",
    "deleteProject",
    "deleteEnvironment",
    "deleteService",
    "containerRegistries",
    "registerGitProvider",
    "updateGitProviderCa",
    "registerContainerRegistry",
    "updateContainerRegistry",
    "deleteContainerRegistry",
    "deleteGitProvider",
    "startGitHubAppManifestSetup",
    "startGitProviderSetup",
    "completeGitLabOAuthSetup",
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
  [
    "composeDriftReport",
    "composePreviews",
    "composePreviewReconciliation",
    "rollbackTargets",
    "deploymentDiff"
  ],
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
  ["backupOverview", "backupRestoreQueue", "backupRunDetails", "serviceBackupWorkflow"],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["backup:read"]
  }
);

apiProcedureAccess.persistentVolumes = {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["volumes:read"]
};

apiProcedureAccess.backupRestorePlan = {
  auth: "authenticated",
  laneOverride: "planning",
  requiredRoles: READ_ROLES,
  requiredScopes: ["backup:read"]
};

apiProcedureAccess.controlPlaneRecoveryPlan = {
  auth: "authenticated",
  laneOverride: "planning",
  requiredRoles: ["owner"],
  requiredScopes: ["backup:read"]
};

addApiGroup(
  apiProcedureAccess,
  [
    "controlPlaneRecoveryBundles",
    "controlPlaneRecoveryBundle",
    "controlPlaneRecoveryBundleMetadata"
  ],
  {
    auth: "authenticated",
    requiredRoles: ["owner"],
    requiredScopes: ["backup:read"]
  }
);

apiProcedureAccess.triggerControlPlaneRecoveryBundle = {
  auth: "authenticated",
  requiredRoles: ["owner"],
  requiredScopes: ["backup:run"]
};

addApiGroup(
  apiProcedureAccess,
  [
    "registerServer",
    "deleteServer",
    "configureServerCapacity",
    "configureServerMetricPolicy",
    "configureServerManagedTraefikProxy",
    "previewServerCleanup",
    "runServerCleanup",
    "planServerPatches",
    "refreshSwarmTopology",
    "updateSwarmNodeAvailability",
    "updateSwarmServiceScale",
    "operationalMaintenanceReport",
    "runOperationalMaintenance"
  ],
  {
    auth: "authenticated",
    requiredRoles: ADMIN_ROLES,
    requiredScopes: ["server:write"]
  }
);

apiProcedureAccess.collectServerResources = {
  auth: "authenticated",
  requiredRoles: READ_ROLES,
  requiredScopes: ["server:read"]
};

addApiGroup(
  apiProcedureAccess,
  [
    "managedTunnels",
    "managedTunnel",
    "logDrains",
    "logDrainDeliveries",
    "managedSshKeys",
    "certificateAssets",
    "serverSshHostIdentities"
  ],
  {
    auth: "authenticated",
    requiredRoles: READ_ROLES,
    requiredScopes: ["server:read"]
  }
);

addApiGroup(
  apiProcedureAccess,
  [
    "createManagedTunnel",
    "updateManagedTunnel",
    "syncManagedTunnelRoutes",
    "rotateManagedTunnelCredentials",
    "deleteManagedTunnel",
    "createLogDrain",
    "deleteLogDrain",
    "testLogDrain",
    "retryLogDrainDelivery"
  ],
  {
    auth: "authenticated",
    requiredRoles: OPS_ROLES,
    requiredScopes: ["server:write"]
  }
);

addApiGroup(
  apiProcedureAccess,
  [
    "createManagedSshKey",
    "rotateManagedSshKey",
    "attachManagedSshKeyToServer",
    "detachManagedSshKeyFromServer",
    "deleteManagedSshKey",
    "createCertificateAsset",
    "deleteCertificateAsset",
    "scanServerSshHostIdentities",
    "approveServerSshHostIdentity",
    "rotateServerSshHostIdentity"
  ],
  {
    auth: "authenticated",
    requiredRoles: ADMIN_ROLES,
    requiredScopes: ["server:write"]
  }
);

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

addApiGroup(apiProcedureAccess, ["retryDevelopmentTask"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["deploy:start"]
});

addApiGroup(apiProcedureAccess, ["cancelDeployment", "cancelDevelopmentTask"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["deploy:cancel"]
});

addApiGroup(apiProcedureAccess, ["executeRollback"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["deploy:rollback"]
});

addApiGroup(apiProcedureAccess, ["createVolume", "updateVolume", "deleteVolume"], {
  auth: "authenticated",
  requiredRoles: WRITE_ROLES,
  requiredScopes: ["volumes:write"]
});

addApiGroup(
  apiProcedureAccess,
  ["createBackupPolicy", "updateBackupPolicy", "deleteBackupPolicy"],
  {
    auth: "authenticated",
    requiredRoles: OPS_ROLES,
    requiredScopes: ["backup:run"]
  }
);

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
    "updateServiceDomainRouting",
    "updateServicePortMappings",
    "createManagedDatabase",
    "setManagedDatabaseState",
    "deleteManagedDatabase",
    "createServiceSchedule",
    "setServiceScheduleState",
    "deleteServiceSchedule",
    "runServiceScheduleNow"
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

addApiGroup(
  apiProcedureAccess,
  ["approveApprovalRequest", "rejectApprovalRequest", "retryApprovalActionDispatch"],
  {
    auth: "authenticated",
    requiredRoles: OPS_ROLES,
    requiredScopes: ["approvals:decide"]
  }
);

addApiGroup(apiProcedureAccess, ["generateAgentToken", "revokeAgentToken"], {
  auth: "authenticated",
  requiredRoles: ADMIN_ROLES,
  requiredScopes: ["tokens:manage"]
});

addApiGroup(
  apiProcedureAccess,
  ["principalInventory", "inviteUser", "updateAccountSecurityPolicy"],
  {
    auth: "authenticated",
    requiredRoles: ADMIN_ROLES,
    requiredScopes: ["members:manage"]
  }
);

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
    id: "backup.restore-plan",
    category: "backup",
    procedure: "backupRestorePlan",
    request: {
      method: "GET",
      path: "/trpc/backupRestorePlan",
      input: { backupRunId: "bkr_123" }
    },
    response: {
      isReady: true,
      backupRun: {
        id: "bkr_123",
        policyId: "bkp_pol_123",
        policyName: "nightly-postgres",
        projectName: "platform",
        environmentName: "production",
        serviceName: "postgres",
        artifactPath: "s3://acme-backups/platform/postgres-2026-03-20.tar.zst",
        checksum: "sha256:abc123",
        verifiedAt: "2026-03-20T11:45:00.000Z",
        restoreCount: 2
      },
      target: {
        destinationServerName: "prod-db-1",
        path: "/var/lib/postgresql/data",
        backupType: "volume",
        databaseEngine: "postgres"
      },
      preflightChecks: [
        { status: "ok", detail: "Backup run completed successfully." },
        { status: "ok", detail: "Artifact path is available for restore download." }
      ],
      steps: [
        "Queue a restore record for the selected backup run",
        "Download the backup artifact from the configured destination",
        "Execute the restore workflow against the target mount path"
      ],
      executeCommand: "daoflow backup restore --backup-run-id bkr_123 --yes",
      approvalRequest: {
        procedure: "requestApproval",
        requiredScope: "approvals:create",
        input: {
          actionType: "backup-restore",
          backupRunId: "bkr_123",
          reason: "Restore backup run bkr_123 after validation."
        }
      }
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
  },
  {
    id: "approval.reject",
    category: "approval",
    procedure: "rejectApprovalRequest",
    request: {
      method: "POST",
      path: "/trpc/rejectApprovalRequest",
      input: { requestId: "apr_abc123" }
    },
    response: {
      id: "apr_abc123",
      status: "rejected"
    }
  }
];

export const cliCommandMeta: Record<string, CliCommandMeta> = {
  login: { lane: "session", requiredScopes: [], mutating: true },
  audit: { lane: "read", requiredScopes: [], mutating: false },
  "access-logs": { lane: "read", requiredScopes: ["logs:read"], mutating: false },
  approvals: { lane: "read", requiredScopes: [], mutating: false },
  "approvals list": { lane: "read", requiredScopes: [], mutating: false },
  "approvals approve": { lane: "command", requiredScopes: ["approvals:decide"], mutating: true },
  "approvals reject": { lane: "command", requiredScopes: ["approvals:decide"], mutating: true },
  services: { lane: "read", requiredScopes: ["service:read"], mutating: false },
  "services list": { lane: "read", requiredScopes: ["service:read"], mutating: false },
  "services previews": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "services create": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "services logging": {
    lane: "read",
    requiredScopes: ["diagnostics:read"],
    mutating: false
  },
  "services logging show": {
    lane: "read",
    requiredScopes: ["diagnostics:read"],
    mutating: false
  },
  "services logging set": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services logging clear": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services schedules": { lane: "read", requiredScopes: ["service:read"], mutating: false },
  "services schedules list": { lane: "read", requiredScopes: ["service:read"], mutating: false },
  "services schedules runs": { lane: "read", requiredScopes: ["service:read"], mutating: false },
  "services schedules create": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services schedules pause": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services schedules resume": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services schedules run": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "services schedules delete": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  databases: { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "databases list": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "databases show": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "databases create": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "databases start": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "databases restart": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "databases stop": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "databases delete": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "services domain": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "services domain routing": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  deploy: { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
  push: { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
  "env list": { lane: "read", requiredScopes: ["env:read"], mutating: false },
  "env pull": { lane: "read", requiredScopes: ["env:read"], mutating: false },
  "env push": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env set": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env delete": { lane: "command", requiredScopes: ["env:write"], mutating: true },
  "env resolve": { lane: "read", requiredScopes: ["secrets:read"], mutating: false },
  logs: { lane: "read", requiredScopes: ["logs:read"], mutating: false },
  maintenance: { lane: "read", requiredScopes: ["server:write"], mutating: false },
  "maintenance report": { lane: "read", requiredScopes: ["server:write"], mutating: false },
  "maintenance run": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  terminal: { lane: "command", requiredScopes: ["terminal:open"], mutating: true },
  "terminal service": { lane: "command", requiredScopes: ["terminal:open"], mutating: true },
  "notifications list": { lane: "read", requiredScopes: [], mutating: false },
  "notifications logs": { lane: "read", requiredScopes: [], mutating: false },
  plan: { lane: "planning", requiredScopes: ["deploy:read"], mutating: false },
  rollback: { lane: "command", requiredScopes: ["deploy:rollback"], mutating: true },
  status: { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "server add": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server capacity": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server proxy": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server ops": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "server ops resources": { lane: "read", requiredScopes: ["server:read"], mutating: true },
  "server ops cleanup": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server ops patch": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server ops swarm": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "server ops swarm refresh-topology": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "server ops swarm node availability": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "server ops swarm service scale": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "server ops history": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "server ops logs": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  tunnels: { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "tunnels list": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "tunnels create": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "tunnels sync": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "tunnels update": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "tunnels rotate": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "tunnels delete": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "log-drains": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "log-drains list": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "log-drains deliveries": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "log-drains create": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "log-drains test": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "log-drains retry": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "log-drains delete": { lane: "command", requiredScopes: ["server:write"], mutating: true },
  "access-assets": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "access-assets ssh-key": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "access-assets ssh-key list": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "access-assets ssh-key create": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets ssh-key rotate": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets ssh-key attach": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets ssh-key detach": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets ssh-key delete": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets certificate": { lane: "read", requiredScopes: ["server:read"], mutating: false },
  "access-assets certificate list": {
    lane: "read",
    requiredScopes: ["server:read"],
    mutating: false
  },
  "access-assets certificate create": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  "access-assets certificate delete": {
    lane: "command",
    requiredScopes: ["server:write"],
    mutating: true
  },
  projects: { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "projects list": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "projects show": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "projects create": { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
  "projects delete": { lane: "command", requiredScopes: ["service:update"], mutating: true },
  "projects env list": { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  "projects env create": {
    lane: "command",
    requiredScopes: ["deploy:start"],
    mutating: true
  },
  "projects env update": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "projects env delete": {
    lane: "command",
    requiredScopes: ["service:update"],
    mutating: true
  },
  "templates list": { lane: "local", requiredScopes: [], mutating: false },
  "templates show": { lane: "local", requiredScopes: [], mutating: false },
  "templates plan": { lane: "planning", requiredScopes: ["deploy:read"], mutating: false },
  "templates apply": { lane: "command", requiredScopes: ["deploy:start"], mutating: true },
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
    requiredScopes: ["backup:restore"],
    mutating: true
  },
  "backup recovery plan": { lane: "planning", requiredScopes: ["backup:read"], mutating: false },
  "backup recovery run": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "backup recovery restore": { lane: "local", requiredScopes: [], mutating: true },
  "backup recovery list": { lane: "read", requiredScopes: ["backup:read"], mutating: false },
  "backup recovery inspect": { lane: "read", requiredScopes: ["backup:read"], mutating: false },
  "backup recovery download-metadata": {
    lane: "read",
    requiredScopes: ["backup:read"],
    mutating: false
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
  "backup policy create": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "backup policy update": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "backup policy delete": { lane: "command", requiredScopes: ["backup:run"], mutating: true },
  "token presets": { lane: "local", requiredScopes: [], mutating: false },
  "token create": { lane: "command", requiredScopes: ["tokens:manage"], mutating: true },
  "token list": { lane: "read", requiredScopes: ["tokens:manage"], mutating: false },
  "token revoke": { lane: "command", requiredScopes: ["tokens:manage"], mutating: true },
  diff: { lane: "planning", requiredScopes: ["deploy:read"], mutating: false },
  cancel: { lane: "command", requiredScopes: ["deploy:cancel"], mutating: true },
  update: { lane: "local", requiredScopes: [], mutating: true },
  "volumes list": { lane: "read", requiredScopes: ["volumes:read"], mutating: false },
  "volumes register": { lane: "command", requiredScopes: ["volumes:write"], mutating: true },
  "volumes update": { lane: "command", requiredScopes: ["volumes:write"], mutating: true },
  "volumes delete": { lane: "command", requiredScopes: ["volumes:write"], mutating: true },
  "config generate-vapid": { lane: "local", requiredScopes: [], mutating: false },
  "config context list": { lane: "local", requiredScopes: [], mutating: false },
  "config context use": { lane: "local", requiredScopes: [], mutating: true },
  "config context delete": { lane: "local", requiredScopes: [], mutating: true },
  events: { lane: "read", requiredScopes: ["events:read"], mutating: false },
  diagnose: { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  drift: { lane: "read", requiredScopes: ["deploy:read"], mutating: false },
  stats: { lane: "read", requiredScopes: ["diagnostics:read"], mutating: false },
  "server-metrics": { lane: "read", requiredScopes: ["diagnostics:read"], mutating: false }
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
    id: "deployment.template-plan",
    category: "deployment",
    command:
      "daoflow templates plan postgres --server srv_db_1 --project-name analytics-db --set postgres_password=replace-me --json",
    response: {
      ok: true,
      data: {
        template: { slug: "postgres", name: "PostgreSQL" },
        projectName: "analytics-db",
        inputs: [
          {
            key: "postgres_password",
            label: "Database password",
            kind: "secret",
            value: "••••••••",
            isSecret: true
          }
        ],
        plan: {
          isReady: true,
          executeCommand: "daoflow deploy --compose templates/postgres.yaml --server srv_db_1"
        }
      }
    }
  },
  {
    id: "server.add-confirmation",
    category: "deployment",
    command: "daoflow server add --name edge-vps-1 --host 203.0.113.42 --json",
    response: {
      ok: false,
      error: "Register server edge-vps-1 at 203.0.113.42. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
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
    id: "backup.restore-dry-run",
    category: "backup",
    command: "daoflow backup restore --backup-run-id bkr_123 --dry-run --json",
    response: {
      ok: true,
      data: {
        dryRun: true,
        plan: {
          isReady: true,
          executeCommand: "daoflow backup restore --backup-run-id bkr_123 --yes",
          approvalRequest: {
            procedure: "requestApproval",
            requiredScope: "approvals:create"
          }
        }
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
  },
  {
    id: "notifications.list",
    category: "auth",
    command: "daoflow notifications list --json",
    response: {
      ok: true,
      data: {
        channels: [
          {
            id: "ntf_ops",
            name: "Ops Alerts",
            channelType: "email",
            webhookUrl: null,
            email: "ops@example.com",
            projectFilter: "DaoFlow",
            environmentFilter: "production",
            eventSelectors: ["deploy.*", "approval.*"],
            enabled: true,
            createdAt: "2026-03-20T12:00:00.000Z",
            updatedAt: "2026-03-20T12:00:00.000Z"
          }
        ]
      }
    }
  }
] as const;
