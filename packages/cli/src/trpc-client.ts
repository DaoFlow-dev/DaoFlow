/**
 * Typed tRPC client for CLI commands.
 *
 * Uses `@trpc/client` with the shared `AppRouter` type from `@daoflow/server/router`
 * so every CLI command gets full type-safety without duplicating return types.
 */
import {
  createTRPCClient,
  httpLink,
  type TRPCClient,
} from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";
import { getCurrentContext, type DaoFlowContext } from "./config";

export type DaoFlowTRPC = TRPCClient<AppRouter>;

/**
 * Create a fully-typed tRPC client configured with the current CLI context.
 *
 * Auth: sends the session token as a `Cookie` header (Better Auth expects this).
 * Throws if no context/token is available — prompts user to run `daoflow login`.
 */
export function createClient(ctx?: DaoFlowContext): DaoFlowTRPC {
  const resolved = ctx ?? getCurrentContext();
  if (!resolved) {
    throw new Error("Not logged in. Run `daoflow login` first.");
  }

  const baseUrl = resolved.apiUrl.replace(/\/$/, "");

  return createTRPCClient<AppRouter>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
        headers() {
          return {
            Cookie: `better-auth.session_token=${resolved.token}`,
          };
        },
      }),
    ],
  });
}
