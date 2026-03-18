import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import { encodeGitInstallationPermissions } from "./git-providers";
import { fetchProjectRepositoryTextFile } from "./project-source-files";
import { resetTestDatabase } from "../../test-db";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

describe("project source files", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("reads GitHub repository files through the installation token flow", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();

    await db.insert(gitProviders).values({
      id: "gitprov_plan_github",
      type: "github",
      name: "Plan GitHub",
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      status: "active",
      updatedAt: new Date()
    });
    await db.insert(gitInstallations).values({
      id: "gitinst_plan_github",
      providerId: "gitprov_plan_github",
      installationId: "777",
      accountName: "example-org",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = toRequestUrl(input);
      if (url.endsWith("/app/installations/777/access_tokens")) {
        return Promise.resolve(
          new Response(JSON.stringify({ token: "ghs_plan" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      }
      if (url.includes("/repos/example-org/platform/contents/deploy%2Fcompose.yaml?ref=main")) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: Buffer.from("services:\n  api:\n    image: example/api:${TAG}\n").toString(
                "base64"
              ),
              encoding: "base64"
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const result = await fetchProjectRepositoryTextFile({
      project: {
        repoFullName: "example-org/platform",
        gitProviderId: "gitprov_plan_github",
        gitInstallationId: "gitinst_plan_github"
      },
      branch: "main",
      path: "deploy/compose.yaml"
    });

    expect(result).toEqual({
      status: "ok",
      content: "services:\n  api:\n    image: example/api:${TAG}\n"
    });
  });

  it("reads GitLab repository files through the stored installation access token", async () => {
    await db.insert(gitProviders).values({
      id: "gitprov_plan_gitlab",
      type: "gitlab",
      name: "Plan GitLab",
      status: "active",
      updatedAt: new Date()
    });
    await db.insert(gitInstallations).values({
      id: "gitinst_plan_gitlab",
      providerId: "gitprov_plan_gitlab",
      installationId: "888",
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "all",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat_plan" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = toRequestUrl(input);
      if (
        url.includes(
          "/projects/example-group%2Fplatform/repository/files/deploy%2Fcompose.yaml?ref=main"
        )
      ) {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              content: Buffer.from("services:\n  api:\n    image: example/api:${TAG}\n").toString(
                "base64"
              ),
              encoding: "base64"
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      }

      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const result = await fetchProjectRepositoryTextFile({
      project: {
        repoFullName: "example-group/platform",
        gitProviderId: "gitprov_plan_gitlab",
        gitInstallationId: "gitinst_plan_gitlab"
      },
      branch: "main",
      path: "deploy/compose.yaml"
    });

    expect(result).toEqual({
      status: "ok",
      content: "services:\n  api:\n    image: example/api:${TAG}\n"
    });
  });
});
