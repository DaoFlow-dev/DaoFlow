import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { ApprovalQueue } from "../features/admin/ApprovalQueue";
import { Skeleton } from "@/components/ui/skeleton";
import { ShieldCheck } from "lucide-react";

export default function ApprovalsPage() {
  const session = useSession();
  const approvalQueue = trpc.approvalQueue.useQuery(
    {},
    {
      enabled: !!session.data,
      refetchInterval: 10_000
    }
  );
  const viewer = trpc.viewer.useQuery(undefined, { enabled: !!session.data });
  const canOperate = viewer.data?.authz?.capabilities?.includes("approvals:decide") ?? false;

  if (session.isPending || approvalQueue.isLoading) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-64 rounded-lg" />
        <Skeleton className="h-32 w-full rounded-xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck size={24} />
        <h1 className="text-2xl font-bold tracking-tight">Approvals</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Review high-risk operations that require human approval before execution.
      </p>
      <ApprovalQueue
        session={session}
        approvalQueue={approvalQueue}
        approvalMessage={null}
        canOperateExecutionJobs={canOperate}
        refreshOperationalViews={async () => {
          await approvalQueue.refetch();
        }}
      />
    </div>
  );
}
