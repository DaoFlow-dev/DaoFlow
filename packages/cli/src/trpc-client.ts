/**
 * Typed tRPC client for CLI commands.
 *
 * The CLI keeps a local contract surface instead of importing server package types
 * so the binary stays decoupled from `@daoflow/server`.
 */
import { createTRPCClient, httpLink } from "@trpc/client";
import { getCurrentContext, type DaoFlowContext } from "./config";
import { buildAuthHeaders } from "./auth-headers";
import type { DaoFlowRouterBase, DaoFlowTRPC } from "./trpc-contract";

export type { CreateAgentInput, RouterOutputs } from "./trpc-contract";

/**
 * Create a fully-typed tRPC client configured with the current CLI context.
 *
 * Auth: sends Better Auth sessions as a cookie and DaoFlow API tokens as Bearer auth.
 * Throws if no context/token is available — prompts user to run `daoflow login`.
 */
export function createClient(ctx?: DaoFlowContext): DaoFlowTRPC {
  const resolved = ctx ?? getCurrentContext();
  if (!resolved) {
    throw new Error("Not logged in. Run `daoflow login` first.");
  }

  const baseUrl = resolved.apiUrl.replace(/\/$/, "");

  return createTRPCClient<DaoFlowRouterBase>({
    links: [
      httpLink({
        url: `${baseUrl}/trpc`,
        headers() {
          return buildAuthHeaders(resolved.token);
        }
      })
    ]
  }) as unknown as DaoFlowTRPC;
}
