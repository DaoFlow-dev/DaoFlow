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
import { createGitProviderSetupState } from "../db/services/git-provider-setup-states";
import { buildGitHubWebBaseUrl, fetchGitHubAppSlug } from "../db/services/github-app-auth";
import { adminProcedure, getActorContext, t } from "../trpc";
import { requireActorTeamId } from "./team-scope";

function notFound() {
  return new TRPCError({ code: "NOT_FOUND", message: "Git provider setup was not found." });
}

export const gitRouter = t.router({
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
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await registerGitProvider({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      return result.summary;
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

      const setup = await createGitProviderSetupState({
        teamId,
        providerId: provider.id,
        providerType: "gitlab",
        action: "gitlab_oauth",
        callbackOrigin: resolveGitProviderCallbackOrigin(),
        initiatedByUserId: ctx.session.user.id
      });

      return {
        authorizationUrl: buildGitLabAuthorizationUrl({
          clientId: provider.clientId,
          baseUrl: provider.baseUrl,
          state: setup.id
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
