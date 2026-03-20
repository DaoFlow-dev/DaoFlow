import { useEffect } from "react";
import { isTRPCClientError } from "@trpc/client";
import { useSession } from "@/lib/auth-client";
import { trpc } from "@/lib/trpc";

export function useBackupRunDetails(runId: string | null | undefined) {
  const session = useSession();
  const normalizedRunId = runId ?? "";
  const query = trpc.backupRunDetails.useQuery(
    {
      runId: normalizedRunId
    },
    {
      enabled: Boolean(session.data) && normalizedRunId.length > 0
    }
  );
  const status = query.data?.status;
  const refetch = query.refetch;

  useEffect(() => {
    if (!normalizedRunId || !status) {
      return;
    }

    if (!["queued", "running"].includes(status)) {
      return;
    }

    const interval = window.setInterval(() => {
      void refetch();
    }, 5000);

    return () => window.clearInterval(interval);
  }, [normalizedRunId, refetch, status]);

  const errorMessage = isTRPCClientError(query.error)
    ? query.error.message
    : query.error
      ? "Unable to load backup run diagnostics right now."
      : null;

  return {
    errorMessage,
    query
  };
}
