import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { createProject } from "../db/services/projects";

export async function createClaimedCommentFixture() {
  const suffix = `${Date.now()}`;
  const providerId = `gitprov_worker_${suffix}`.slice(0, 32);
  const installationId = `gitinst_worker_${suffix}`.slice(0, 32);
  const repoFullName = "example/worker-status-comment";
  const projectResult = await createProject({
    name: `Worker Status Comment ${suffix}`,
    repoUrl: `https://github.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  if (projectResult.status !== "ok") {
    throw new Error("Failed to create worker status comment project.");
  }

  const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs1" })
    .toString();

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "github",
    name: `GitHub Worker Status ${suffix}`,
    appId: "123456",
    privateKeyEncrypted: encrypt(privateKeyPem),
    webhookSecret: "github-worker-status-secret",
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: "9107",
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  await db
    .update(projects)
    .set({
      repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: false,
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  return {
    projectId: projectResult.project.id,
    repoFullName,
    installationId
  };
}
