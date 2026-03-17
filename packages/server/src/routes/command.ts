import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createDeploymentRecord } from "../db/services/deployments";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest
} from "../db/services/approvals";
import {
  queueBackupRestore,
  triggerBackupRun,
  enableBackupSchedule,
  disableBackupSchedule,
  triggerBackupNow
} from "../db/services/backups";
import {
  createDestination,
  updateDestination,
  deleteDestination,
  testDestinationConnection
} from "../db/services/destinations";
import { queueComposeRelease } from "../db/services/compose";
import { upsertEnvironmentVariable } from "../db/services/envvars";
import {
  completeExecutionJob,
  dispatchExecutionJob,
  failExecutionJob
} from "../db/services/execution";
import { registerServer } from "../db/services/servers";
import {
  createProject,
  updateProject,
  deleteProject,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment
} from "../db/services/projects";
import { createService, updateService, deleteService } from "../db/services/services";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { executeRollback } from "../db/services/execute-rollback";
import { createAgentPrincipal, generateAgentToken, revokeAgentToken } from "../db/services/agents";
import {
  registerGitProvider,
  deleteGitProvider,
  createGitInstallation
} from "../db/services/git-providers";
import { decrypt } from "../db/crypto";
import {
  t,
  adminProcedure,
  serverWriteProcedure,
  deployStartProcedure,
  deployRollbackProcedure,
  envWriteProcedure,
  serviceUpdateProcedure,
  backupRunProcedure,
  backupRestoreProcedure,
  approvalsCreateProcedure,
  approvalsDecideProcedure,
  tokensManageProcedure,
  getActorContext,
  getUpdaterContext,
  throwOnOperationError
} from "../trpc";

export const commandRouter = t.router({
  registerServer: serverWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        host: z.string().min(1).max(120),
        region: z.string().min(1).max(60),
        sshPort: z.number().int().min(1).max(65535),
        kind: z.enum(["docker-engine", "docker-swarm-manager"])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await registerServer({
        ...input,
        ...getActorContext(ctx)
      });

      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A server with this ${result.conflictField} already exists.`
        });
      }

      return result.server;
    }),
  createDeploymentRecord: deployStartProcedure
    .input(
      z.object({
        projectName: z.string().min(1).max(80),
        environmentName: z.string().min(1).max(80),
        serviceName: z.string().min(1).max(80),
        sourceType: z.enum(["compose", "dockerfile", "image"]),
        targetServerId: z.string().min(1),
        commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
        imageTag: z.string().min(1).max(160),
        steps: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              detail: z.string().min(1).max(280)
            })
          )
          .min(1)
          .max(6)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await createDeploymentRecord({
        ...input,
        ...getActorContext(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target server not found."
        });
      }

      return deployment;
    }),
  queueComposeRelease: deployStartProcedure
    .input(
      z.object({
        composeServiceId: z.string().min(1),
        commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
        imageTag: z.string().min(1).max(160).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await queueComposeRelease({
        ...input,
        ...getActorContext(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose release target not found."
        });
      }

      return deployment;
    }),
  upsertEnvironmentVariable: envWriteProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        key: z
          .string()
          .regex(/^[A-Z_][A-Z0-9_]*$/)
          .max(80),
        value: z.string().min(1).max(4000),
        isSecret: z.boolean(),
        category: z.enum(["runtime", "build"]),
        branchPattern: z.string().max(120).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const variable = await upsertEnvironmentVariable({
        ...input,
        ...getUpdaterContext(ctx)
      });

      if (!variable) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment record not found."
        });
      }

      return variable;
    }),
  requestApproval: approvalsCreateProcedure
    .input(
      z.discriminatedUnion("actionType", [
        z.object({
          actionType: z.literal("compose-release"),
          composeServiceId: z.string().min(1),
          commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
          imageTag: z.string().min(1).max(160).optional(),
          reason: z.string().min(12).max(280)
        }),
        z.object({
          actionType: z.literal("backup-restore"),
          backupRunId: z.string().min(1),
          reason: z.string().min(12).max(280)
        })
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const request = await createApprovalRequest({
        ...input,
        ...getActorContext(ctx)
      });

      if (!request) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.actionType === "compose-release"
              ? "Compose release target not found."
              : "Only successful backup runs with an artifact can be submitted for approval."
        });
      }

      return request;
    }),
  approveApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await approveApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),
  rejectApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await rejectApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),
  triggerBackupRun: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const run = await triggerBackupRun(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return run;
    }),
  enableBackupSchedule: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1),
        schedule: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await enableBackupSchedule(
        input.policyId,
        input.schedule,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return result;
    }),
  disableBackupSchedule: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await disableBackupSchedule(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return result;
    }),
  triggerBackupNow: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await triggerBackupNow(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return result;
    }),
  queueBackupRestore: backupRestoreProcedure
    .input(
      z.object({
        backupRunId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const restore = await queueBackupRestore(
        input.backupRunId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!restore) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only successful backup runs with an artifact can be restored."
        });
      }

      return restore;
    }),
  dispatchExecutionJob: deployStartProcedure
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await dispatchExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  completeExecutionJob: deployStartProcedure
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await completeExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  failExecutionJob: deployStartProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
        reason: z.string().min(1).max(280).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await failExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole,
        input.reason
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),

  /* ── Project CRUD ──────────────────────────────────────────────── */
  createProject: deployStartProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        repoUrl: z.string().max(300).optional(),
        defaultBranch: z.string().max(80).optional(),
        teamId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createProject({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      return result.project;
    }),

  updateProject: serviceUpdateProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(500).optional(),
        repoUrl: z.string().max(300).optional(),
        defaultBranch: z.string().max(80).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateProject({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      return result.project;
    }),

  deleteProject: adminProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteProject({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return { deleted: true };
    }),

  /* ── Environment CRUD ──────────────────────────────────────────── */
  createEnvironment: deployStartProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(80),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createEnvironment({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent project not found." });
      }
      return result.environment;
    }),

  updateEnvironment: serviceUpdateProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        status: z.string().max(40).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateEnvironment({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return result.environment;
    }),

  deleteEnvironment: adminProcedure
    .input(z.object({ environmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteEnvironment({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return { deleted: true };
    }),

  /* ── Service CRUD ──────────────────────────────────────────── */
  createService: serviceUpdateProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        environmentId: z.string().min(1),
        projectId: z.string().min(1),
        sourceType: z.enum(["compose", "dockerfile", "image"]),
        imageReference: z.string().max(255).optional(),
        dockerfilePath: z.string().max(500).optional(),
        composeServiceName: z.string().max(100).optional(),
        port: z.string().max(20).optional(),
        healthcheckPath: z.string().max(255).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A service with this name already exists in the environment.`
        });
      }
      return result.service;
    }),

  updateService: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        sourceType: z.enum(["compose", "dockerfile", "image"]).optional(),
        imageReference: z.string().max(255).optional(),
        dockerfilePath: z.string().max(500).optional(),
        composeServiceName: z.string().max(100).optional(),
        port: z.string().max(20).optional(),
        healthcheckPath: z.string().max(255).optional(),
        replicaCount: z.string().max(5).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return result.service;
    }),

  deleteService: adminProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return { deleted: true };
    }),

  /* ── Deploy from Service ───────────────────────────────────── */
  triggerDeploy: deployStartProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        commitSha: z.string().optional(),
        imageTag: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await triggerDeploy({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity ?? "Resource"} not found.`
        });
      }
      if (result.status === "no_server") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No target server configured for this service or environment."
        });
      }
      if (result.status === "create_failed") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create deployment record."
        });
      }
      return result.deployment;
    }),

  /* ── Rollback ──────────────────────────────────────────────── */
  executeRollback: deployRollbackProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        targetDeploymentId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeRollback({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity ?? "Resource"} not found.`
        });
      }
      if (result.status === "invalid_target") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target deployment is not a successful deployment."
        });
      }
      if (result.status === "outside_retention") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Target deployment is outside the retention window (${result.retention} versions).`
        });
      }
      if (result.status === "create_failed") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create rollback deployment."
        });
      }
      return result.deployment;
    }),

  /* ── Agent Management ────────────────────────────────────── */
  createAgent: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(255).optional(),
        scopes: z.array(z.string()).min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createAgentPrincipal({
        ...input,
        ...getActorContext(ctx)
      });
      return result.principal;
    }),

  generateAgentToken: tokensManageProcedure
    .input(
      z.object({
        principalId: z.string().min(1),
        tokenName: z.string().min(1).max(80),
        expiresInDays: z.number().int().min(1).max(365).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await generateAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      }
      return { token: result.token, tokenValue: result.tokenValue };
    }),

  revokeAgentToken: tokensManageProcedure
    .input(z.object({ tokenId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await revokeAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found." });
      }
      return { revoked: true };
    }),

  /* ── Git Providers ──────────────────────────────────────── */
  registerGitProvider: adminProcedure
    .input(
      z.object({
        type: z.enum(["github", "gitlab"]),
        name: z.string().min(1).max(100),
        appId: z.string().max(40).optional(),
        clientId: z.string().max(80).optional(),
        clientSecret: z.string().optional(),
        privateKey: z.string().optional(),
        webhookSecret: z.string().max(128).optional(),
        baseUrl: z.string().max(255).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await registerGitProvider({
        ...input,
        ...getActorContext(ctx)
      });
      return result.provider;
    }),

  deleteGitProvider: adminProcedure
    .input(z.object({ providerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      await deleteGitProvider(input.providerId, getActorContext(ctx));
      return { deleted: true };
    }),

  createGitInstallation: adminProcedure
    .input(
      z.object({
        providerId: z.string().min(1),
        installationId: z.string().min(1),
        accountName: z.string().min(1).max(100),
        accountType: z.string().max(20).optional(),
        repositorySelection: z.string().max(20).optional(),
        permissions: z.string().optional(),
        installedByUserId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createGitInstallation({
        ...input,
        ...getActorContext(ctx)
      });
      return result.installation;
    }),

  exchangeGitLabCode: adminProcedure
    .input(
      z.object({
        code: z.string().min(1),
        providerId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const { getGitProvider } = await import("../db/services/git-providers");
      const provider = await getGitProvider(input.providerId);
      if (!provider) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Git provider not found" });
      }
      if (provider.type !== "gitlab") {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Provider is not GitLab" });
      }

      // Exchange code for access token via GitLab OAuth
      const gitlabBaseUrl = provider.baseUrl || "https://gitlab.com";
      const tokenUrl = `${gitlabBaseUrl}/oauth/token`;

      const tokenResponse = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          client_id: provider.clientId,
          client_secret: provider.clientSecretEncrypted
            ? decrypt(provider.clientSecretEncrypted)
            : "",
          code: input.code,
          grant_type: "authorization_code",
          redirect_uri: `${process.env.APP_BASE_URL || "http://localhost:3000"}/settings/git/callback`
        })
      });

      if (!tokenResponse.ok) {
        const err = await tokenResponse.text();
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `GitLab token exchange failed: ${err}`
        });
      }

      const tokenData = (await tokenResponse.json()) as { access_token?: string };
      if (!tokenData.access_token) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "No access token returned from GitLab"
        });
      }

      // Fetch user info to get account name
      const userResponse = await fetch(`${gitlabBaseUrl}/api/v4/user`, {
        headers: { Authorization: `Bearer ${tokenData.access_token}` }
      });
      const userData = (await userResponse.json()) as {
        username?: string;
        id?: number;
      };

      const result = await createGitInstallation({
        providerId: input.providerId,
        installationId: String(userData.id ?? "unknown"),
        accountName: userData.username ?? "unknown",
        accountType: "user",
        permissions: JSON.stringify({ access_token: tokenData.access_token }),
        ...getActorContext(ctx)
      });

      return result;
    }),
  createBackupDestination: backupRunProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        provider: z.enum(["s3", "local", "gdrive", "onedrive", "dropbox", "sftp", "rclone"]),
        accessKey: z.string().optional(),
        secretAccessKey: z.string().optional(),
        bucket: z.string().optional(),
        region: z.string().optional(),
        endpoint: z.string().optional(),
        s3Provider: z.string().optional(),
        rcloneType: z.string().optional(),
        rcloneConfig: z.string().optional(),
        rcloneRemotePath: z.string().optional(),
        oauthToken: z.string().optional(),
        localPath: z.string().optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      return createDestination(
        input,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
    }),
  updateBackupDestination: backupRunProcedure
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        provider: z
          .enum(["s3", "local", "gdrive", "onedrive", "dropbox", "sftp", "rclone"])
          .optional(),
        accessKey: z.string().optional(),
        secretAccessKey: z.string().optional(),
        bucket: z.string().optional(),
        region: z.string().optional(),
        endpoint: z.string().optional(),
        s3Provider: z.string().optional(),
        rcloneType: z.string().optional(),
        rcloneConfig: z.string().optional(),
        rcloneRemotePath: z.string().optional(),
        oauthToken: z.string().optional(),
        localPath: z.string().optional()
      })
    )
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const result = await updateDestination(
        input,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }
      return result;
    }),
  deleteBackupDestination: backupRunProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const result = await deleteDestination(
        input.id,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result.deleted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Delete failed." });
      }
      return { ok: true };
    }),
  testBackupDestination: backupRunProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return testDestinationConnection(input.id);
    })
});
