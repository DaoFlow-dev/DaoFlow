import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "./db/connection";
import { approvalRequests } from "./db/schema/audit";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { createProject } from "./db/services/projects";
import { shouldIncrementPreviewTrustRevision } from "./db/services/project-write-service";
import {
  buildPreviewApprovalBinding,
  classifyPreviewOrigin,
  evaluatePreviewPolicy,
  validatePreviewDeploymentAuthorization
} from "./preview-trust";
import {
  readGitHubPreviewLifecycle,
  readGitLabPreviewLifecycle
} from "./webhook-preview-lifecycle";
import { resetTestDatabaseWithControlPlane } from "./test-db";

const commitSha = "1234567890abcdef1234567890abcdef12345678";

describe("preview trust", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("classifies provider source repositories before evaluating preview policy", () => {
    const github = readGitHubPreviewLifecycle({
      action: "opened",
      number: 15,
      repository: { full_name: "acme/api" },
      installation: { account: { login: "acme" } },
      pull_request: {
        head: {
          ref: "feature/preview",
          sha: commitSha,
          repo: { full_name: "acme/api" }
        },
        author_association: "CONTRIBUTOR"
      },
      sender: { login: "octocat" }
    });
    const gitlab = readGitLabPreviewLifecycle({
      object_kind: "merge_request",
      project: { path_with_namespace: "acme/api" },
      user: { username: "gitlab-bot" },
      object_attributes: {
        iid: 16,
        action: "open",
        source_branch: "feature/preview",
        source: { path_with_namespace: "contributor/api" },
        last_commit: { id: commitSha }
      }
    });

    expect(github?.origin).toMatchObject({
      providerType: "github",
      baseRepository: "acme/api",
      sourceRepository: "acme/api",
      repositoryRelationship: "same-repository",
      authorAssociation: "CONTRIBUTOR"
    });
    expect(gitlab?.origin).toMatchObject({
      providerType: "gitlab",
      baseRepository: "acme/api",
      sourceRepository: "contributor/api",
      repositoryRelationship: "fork"
    });

    const sameRepository = classifyPreviewOrigin({
      providerType: "github",
      baseRepository: "acme/api",
      sourceRepository: "acme/api",
      installationVerified: true,
      protectedSecretsAttached: true
    });
    expect(
      evaluatePreviewPolicy({ policy: "manual-approval", origin: sameRepository })
    ).toMatchObject({ decision: "approval-required" });
    expect(
      evaluatePreviewPolicy({
        policy: "manual-approval",
        origin: gitlab!.origin
      })
    ).toMatchObject({ decision: "blocked" });
  });

  it("invalidates approvals when source or repository preparation trust changes", () => {
    expect(
      shouldIncrementPreviewTrustRevision({
        previewPolicyChanged: false,
        sourceFieldsTouched: true,
        repositoryPreparationTouched: false
      })
    ).toBe(true);
    expect(
      shouldIncrementPreviewTrustRevision({
        previewPolicyChanged: false,
        sourceFieldsTouched: false,
        repositoryPreparationTouched: true
      })
    ).toBe(true);
  });

  it("requires an approved, unexpired binding for the same provider, repository, SHA, and policy revision", async () => {
    const projectResult = await createProject({
      name: "Preview trust binding",
      teamId: "team_foundation",
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(projectResult.status).toBe("ok");
    if (projectResult.status !== "ok") {
      throw new Error("Failed to create preview trust project.");
    }

    await db.insert(gitProviders).values({
      id: "gitprov_preview_trust",
      type: "github",
      name: "Preview trust GitHub App",
      webhookSecret: "preview-trust-secret",
      status: "active"
    });
    await db.insert(gitInstallations).values({
      id: "gitinst_preview_trust",
      providerId: "gitprov_preview_trust",
      installationId: "4242",
      accountName: "acme",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active"
    });

    await db
      .update(projects)
      .set({
        repoFullName: "acme/api",
        gitProviderId: "gitprov_preview_trust",
        gitInstallationId: "gitinst_preview_trust",
        previewPolicy: "manual-approval",
        previewPolicyRevision: 4
      })
      .where(eq(projects.id, projectResult.project.id));
    const [project] = await db
      .select()
      .from(projects)
      .where(eq(projects.id, projectResult.project.id));
    if (!project) {
      throw new Error("Preview trust project was not found.");
    }

    const origin = classifyPreviewOrigin({
      providerType: "github",
      baseRepository: "acme/api",
      sourceRepository: "acme/api",
      authorAssociation: "MEMBER",
      installationOwner: "acme",
      installationVerified: true,
      protectedSecretsAttached: true
    });
    const binding = buildPreviewApprovalBinding({
      providerType: "github",
      providerId: "gitprov_preview_trust",
      installationId: "gitinst_preview_trust",
      sourceRepository: "acme/api",
      baseRepository: "acme/api",
      commitSha,
      policyRevision: 4,
      origin,
      serviceId: "svc_preview_trust",
      preview: {
        target: "pull-request",
        pullRequestNumber: 17,
        branch: "feature/preview",
        action: "deploy"
      }
    });

    await db.insert(approvalRequests).values({
      id: "apr_preview_trust",
      actionType: "preview-deployment",
      targetResource: "service/svc_preview_trust",
      status: "approved",
      requestedByEmail: "github-webhook",
      requestedByRole: "agent",
      resolvedByUserId: "user_foundation_operator",
      resolvedByEmail: "operator@daoflow.local",
      inputSummary: {
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        previewTrust: binding
      },
      createdAt: new Date(),
      resolvedAt: new Date()
    });

    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project,
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha,
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/preview",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: true });
    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project: { ...project, gitInstallationId: "gitinst_changed" },
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha,
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/preview",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: false });
    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project,
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha: "abcdefabcdefabcdefabcdefabcdefabcdefabcd",
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/preview",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: false });

    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project,
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha,
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/other-branch",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: false });

    const expiredBinding = {
      ...binding,
      expiresAt: new Date(Date.now() - 60_000).toISOString()
    };
    await db
      .update(approvalRequests)
      .set({
        inputSummary: {
          expiresAt: expiredBinding.expiresAt,
          previewTrust: expiredBinding
        }
      })
      .where(eq(approvalRequests.id, "apr_preview_trust"));
    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project,
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha,
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/preview",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: false });

    await db
      .update(approvalRequests)
      .set({
        inputSummary: {
          expiresAt: binding.expiresAt,
          previewTrust: binding
        }
      })
      .where(eq(approvalRequests.id, "apr_preview_trust"));

    await db.update(projects).set({ previewPolicyRevision: 5 }).where(eq(projects.id, project.id));
    const [revisedProject] = await db.select().from(projects).where(eq(projects.id, project.id));
    if (!revisedProject) throw new Error("Expected revised preview project.");
    await expect(
      validatePreviewDeploymentAuthorization({
        authorization: { kind: "approval", approvalRequestId: "apr_preview_trust" },
        project: revisedProject,
        serviceId: "svc_preview_trust",
        providerType: "github",
        commitSha,
        preview: {
          target: "pull-request",
          pullRequestNumber: 17,
          branch: "feature/preview",
          action: "deploy"
        }
      })
    ).resolves.toMatchObject({ allowed: false });
  });
});
