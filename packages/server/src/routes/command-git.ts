import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  deleteGitProvider,
  getGitProvider,
  registerGitProvider
} from "../db/services/git-providers";
import {
  buildGitLabAuthorizationUrl,
  completeGitLabOAuthSetup,
  resolveGitProviderCallbackOrigin
} from "../db/services/git-provider-callbacks";
import {
  createGitLabPkcePair,
  createGitProviderSetupState
} from "../db/services/git-provider-setup-states";
import { GitLabCredentialValidationError } from "../db/services/gitlab-installation-auth";
import { resolveGitLabPublicBaseUrl } from "../db/services/gitlab-urls";
import { buildGitHubWebBaseUrl, fetchGitHubAppSlug } from "../db/services/github-app-auth";
import { adminProcedure, getActorContext, t } from "../trpc";
import { requireActorTeamId } from "./team-scope";

function notFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Git provider setup was not found." });
}

export const gitRouter = t.router({
  registerGitProvider: adminProcedure
    .input(
      z
        .object({
          type: z.enum(["github", "gitlab"]),
          name: z.string().min(1).max(100),
          appId: z.string().max(40).optional(),
          clientId: z.string().max(80).optional(),
          clientSecret: z.string().optional(),
          privateKey: z.string().optional(),
          webhookSecret: z.string().max(128).optional(),
          baseUrl: z.string().max(255).optional(),
          internalBaseUrl: z.string().max(255).optional(),
          gitlabCredential: z
            .discriminatedUnion("kind", [
              z.object({ kind: z.literal("oauth") }),
              z.object({
                kind: z.literal("api_token"),
                token: z.string().min(1),
                expiresAt: z.string().datetime({ offset: true }).optional()
              }),
              z.object({
                kind: z.literal("deploy_token"),
                username: z.string().min(1).max(100),
                token: z.string().min(1),
                expiresAt: z.string().datetime({ offset: true }).optional()
              })
            ])
            .optional()
        })
        .superRefine((input, ctx) => {
          if (input.type !== "gitlab" && input.gitlabCredential) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["gitlabCredential"],
              message: "GitLab credentials can only be registered with GitLab providers."
            });
          }
          if (
            input.type === "gitlab" &&
            input.gitlabCredential?.kind === "oauth" &&
            (!input.clientId?.trim() || !input.clientSecret?.trim())
          ) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["gitlabCredential"],
              message: "GitLab OAuth registration requires a client ID and client secret."
            });
          }
        })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      try {
        const result = await registerGitProvider({
          ...input,
          teamId,
          ...getActorContext(ctx)
        });
        return result.summary;
      } catch (error) {
        if (error instanceof GitLabCredentialValidationError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: "GitLab API token could not be validated."
          });
        }
        if (error instanceof Error && error.message.startsWith("GitLab")) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }
    }),

  deleteGitProvider: adminProcedure
    .input(z.object({ providerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteGitProvider(input.providerId, teamId, getActorContext(ctx));
      if (result.status === "not_found") {
        throw notFound();
      }
      return { deleted: true };
    }),

  startGitHubAppManifestSetup: adminProcedure.mutation(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    const setup = await createGitProviderSetupState({
      teamId,
      providerType: "github",
      action: "github_manifest",
      callbackOrigin: resolveGitProviderCallbackOrigin(),
      initiatedByUserId: ctx.session.user.id
    });
    return { state: setup.id };
  }),

  startGitProviderSetup: adminProcedure
    .input(z.object({ providerId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const provider = await getGitProvider(input.providerId, teamId);
      if (!provider || (provider.type !== "github" && provider.type !== "gitlab")) {
        throw notFound();
      }

      if (provider.type === "github") {
        if (
          !provider.appId ||
          !provider.clientId ||
          !provider.clientSecretEncrypted ||
          !provider.privateKeyEncrypted
        ) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "GitHub provider is missing app or OAuth setup details."
          });
        }
        let appSlug: string;
        try {
          appSlug = await fetchGitHubAppSlug(provider);
        } catch {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: "GitHub App credentials could not be verified."
          });
        }
        const setup = await createGitProviderSetupState({
          teamId,
          providerId: provider.id,
          providerType: "github",
          action: "github_installation",
          callbackOrigin: resolveGitProviderCallbackOrigin(),
          initiatedByUserId: ctx.session.user.id
        });
        return {
          authorizationUrl: `${buildGitHubWebBaseUrl(provider.baseUrl)}/apps/${encodeURIComponent(appSlug)}/installations/new?state=${encodeURIComponent(setup.id)}`
        };
      }

      if (!provider.clientId || !provider.clientSecretEncrypted) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitLab provider is missing OAuth setup details."
        });
      }

      const pkce = createGitLabPkcePair();
      const setup = await createGitProviderSetupState({
        teamId,
        providerId: provider.id,
        providerType: "gitlab",
        action: "gitlab_oauth",
        callbackOrigin: resolveGitProviderCallbackOrigin(),
        providerPublicBaseUrl: resolveGitLabPublicBaseUrl(provider),
        codeVerifier: pkce.verifier,
        initiatedByUserId: ctx.session.user.id
      });

      return {
        authorizationUrl: buildGitLabAuthorizationUrl({
          clientId: provider.clientId,
          baseUrl: provider.baseUrl,
          state: setup.id,
          codeChallenge: pkce.challenge
        })
      };
    }),

  completeGitLabOAuthSetup: adminProcedure
    .input(z.object({ state: z.string().length(32), code: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await completeGitLabOAuthSetup({
        ...input,
        initiatedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw notFound();
      }
      if (result.status === "invalid_provider") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "GitLab provider is missing required OAuth credentials."
        });
      }
      if (result.status === "exchange_failed") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "GitLab authorization could not be completed."
        });
      }
      return result.summary;
    })
});
