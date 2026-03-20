import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { TRPCClientError, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";
import { maybeRedirectToLoginForHttpStatus } from "./auth-redirect";

export const trpc = createTRPCReact<AppRouter>();

function maybeHandleUnauthorized(error: unknown) {
  if (!(error instanceof TRPCClientError)) {
    return;
  }

  const data: unknown = error.data;
  const httpStatus =
    data && typeof data === "object" && "httpStatus" in data && typeof data.httpStatus === "number"
      ? data.httpStatus
      : null;
  maybeRedirectToLoginForHttpStatus(httpStatus);
}

export function makeQueryClient() {
  return new QueryClient({
    queryCache: new QueryCache({
      onError: maybeHandleUnauthorized
    }),
    mutationCache: new MutationCache({
      onError: maybeHandleUnauthorized
    })
  });
}

export function makeTrpcClient() {
  return trpc.createClient({
    links: [
      httpBatchLink({
        url: "/trpc"
      })
    ]
  });
}
