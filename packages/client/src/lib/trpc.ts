import { QueryClient } from "@tanstack/react-query";
import { createTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@daoflow/server/router";

export const trpc = createTRPCReact<AppRouter>();

export function makeQueryClient() {
  return new QueryClient();
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
