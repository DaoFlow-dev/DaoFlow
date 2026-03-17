import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  registerGitProvider,
  deleteGitProvider,
  createGitInstallation
} from "../db/services/git-providers";
import { decrypt } from "../db/crypto";
import { t, adminProcedure, getActorContext } from "../trpc";

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
    })
});
