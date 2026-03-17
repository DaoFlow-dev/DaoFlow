import { MutationCache, QueryCache, QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { TRPCClientError, httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";

export const trpc = createTRPCReact<AppRouter>();

function redirectToLoginWithReturnTo() {
  if (typeof window === "undefined") {
    return;
  }

  const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const returnTo = currentPath === "/login" ? "/" : currentPath;
  window.location.assign(`/login?returnTo=${encodeURIComponent(returnTo)}`);
}

function maybeHandleUnauthorized(error: unknown) {
  if (!(error instanceof TRPCClientError)) {
    return;
  }

  const data: unknown = error.data;
  const httpStatus =
    data && typeof data === "object" && "httpStatus" in data && typeof data.httpStatus === "number"
      ? data.httpStatus
      : null;
  if (httpStatus === 401) {
    redirectToLoginWithReturnTo();
  }
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
