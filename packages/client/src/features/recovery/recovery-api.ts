import { trpc } from "@/lib/trpc";
import type {
  RecoveryBundle,
  RecoveryMetadata,
  RecoveryMutationState,
  RecoveryPlan,
  RecoveryQueryState
} from "./types";

export type RecoveryBundleList =
  RecoveryBundle[] | { bundles: RecoveryBundle[]; [key: string]: unknown };

interface RecoveryTrpcProcedures {
  controlPlaneRecoveryPlan: {
    useQuery: (
      input: { destinationId: string },
      options: { enabled: boolean }
    ) => RecoveryQueryState<RecoveryPlan>;
  };
  controlPlaneRecoveryBundles: {
    useQuery: (
      input: { limit?: number },
      options: { enabled: boolean }
    ) => RecoveryQueryState<RecoveryBundleList>;
  };
  controlPlaneRecoveryBundle: {
    useQuery: (
      input: { bundleId: string },
      options: { enabled: boolean }
    ) => RecoveryQueryState<RecoveryBundle>;
  };
  controlPlaneRecoveryBundleMetadata: {
    useQuery: (
      input: { bundleId: string },
      options: { enabled: boolean }
    ) => RecoveryQueryState<RecoveryMetadata>;
  };
  triggerControlPlaneRecoveryBundle: {
    useMutation: () => RecoveryMutationState<RecoveryBundle>;
  };
}

/** The server procedures are added independently; keep this client boundary server-package-free. */
export const recoveryTrpc = trpc as unknown as RecoveryTrpcProcedures;

export function recoveryBundleList(data: RecoveryBundleList | undefined): RecoveryBundle[] {
  if (Array.isArray(data)) return data;
  return data?.bundles ?? [];
}
