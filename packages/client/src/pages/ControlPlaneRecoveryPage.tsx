import { useState } from "react";
import { Link } from "react-router-dom";
import { isTRPCClientError } from "@trpc/client";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorRetry } from "@/components/QueryErrorRetry";
import { RecoveryBundleCatalog } from "@/components/recovery/RecoveryBundleCatalog";
import { RecoveryDetails } from "@/components/recovery/RecoveryDetails";
import { recoveryBundleList, recoveryTrpc } from "@/features/recovery/recovery-api";
import { useSession } from "@/lib/auth-client";
import { queryErrorMessage } from "@/lib/query-error-message";
import { trpc } from "@/lib/trpc";

function errorMessage(error: unknown, fallback: string): string {
  return isTRPCClientError(error) || error instanceof Error ? error.message : fallback;
}

export default function ControlPlaneRecoveryPage() {
  const session = useSession();
  const destinations = trpc.backupDestinations.useQuery({}, { enabled: Boolean(session.data) });
  const destinationOptions = destinations.data ?? [];
  const [destinationId, setDestinationId] = useState("");
  const [selectedBundleId, setSelectedBundleId] = useState<string | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  const activeDestinationId = destinationId || String(destinationOptions[0]?.id ?? "");
  const plan = recoveryTrpc.controlPlaneRecoveryPlan.useQuery(
    { destinationId: activeDestinationId },
    { enabled: Boolean(session.data && activeDestinationId) }
  );
  const bundles = recoveryTrpc.controlPlaneRecoveryBundles.useQuery(
    { limit: 12 },
    { enabled: Boolean(session.data) }
  );
  const selectedBundle = recoveryTrpc.controlPlaneRecoveryBundle.useQuery(
    { bundleId: selectedBundleId ?? "" },
    { enabled: Boolean(session.data && selectedBundleId) }
  );
  const selectedMetadata = recoveryTrpc.controlPlaneRecoveryBundleMetadata.useQuery(
    { bundleId: selectedBundleId ?? "" },
    { enabled: Boolean(session.data && selectedBundleId) }
  );
  const runRecovery = recoveryTrpc.triggerControlPlaneRecoveryBundle.useMutation();

  const recentBundles = recoveryBundleList(bundles.data);
  const selectedDestination = destinationOptions.find(
    (destination) => String(destination.id) === activeDestinationId
  );

  async function handleRun() {
    if (!activeDestinationId || plan.data?.isReady !== true) return;
    setFeedback(null);
    try {
      const bundle = await runRecovery.mutateAsync({ destinationId: activeDestinationId });
      setFeedback(`Recovery bundle ${bundle.id} was queued.`);
      setConfirmOpen(false);
      await Promise.all([bundles.refetch(), plan.refetch()]);
    } catch (error) {
      setFeedback(errorMessage(error, "Unable to create a recovery bundle."));
      setConfirmOpen(false);
    }
  }

  return (
    <main className="shell flex flex-col gap-6" data-testid="control-plane-recovery-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-2">
          <Link
            to="/backups"
            className="text-sm text-muted-foreground hover:text-foreground"
            data-testid="recovery-back-to-backups"
          >
            ← Back to backups
          </Link>
          <h1
            className="font-display text-2xl font-bold tracking-tight"
            data-testid="recovery-page-title"
          >
            Control-plane recovery
          </h1>
          <p
            className="max-w-2xl text-sm text-muted-foreground"
            data-testid="recovery-page-description"
          >
            Create an encrypted, versioned DaoFlow recovery bundle and verify it in isolation before
            an incident.
          </p>
        </div>
        <Badge variant="outline" data-testid="recovery-owner-only-badge">
          Owner only
        </Badge>
      </div>

      {feedback ? (
        <Alert data-testid="recovery-feedback">
          <AlertTitle>Recovery operation</AlertTitle>
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}

      {destinations.isLoading ? (
        <Skeleton className="h-32 w-full" data-testid="recovery-destinations-loading" />
      ) : destinations.isError ? (
        <div data-testid="recovery-destinations-error">
          <QueryErrorRetry
            message={queryErrorMessage(destinations.error, "Unable to load backup destinations.")}
            onRetry={() => void destinations.refetch()}
            isRetrying={destinations.isFetching}
          />
        </div>
      ) : destinationOptions.length === 0 ? (
        <Alert data-testid="recovery-no-destinations">
          <AlertTitle>No backup destination configured</AlertTitle>
          <AlertDescription>
            Add and test a backup destination before planning control-plane recovery.
            <Link
              to="/destinations"
              className="ml-1 underline"
              data-testid="recovery-open-destinations"
            >
              Open destinations
            </Link>
          </AlertDescription>
        </Alert>
      ) : (
        <>
          <Card data-testid="recovery-planning-card">
            <CardHeader>
              <CardTitle className="text-base">Plan recovery</CardTitle>
              <CardDescription>
                Select the existing backup destination to evaluate readiness.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <label className="flex flex-col gap-2 text-sm" htmlFor="recovery-destination-select">
                <span className="font-medium">Backup destination</span>
                <Select
                  value={activeDestinationId}
                  onValueChange={(value) => {
                    setDestinationId(value ?? "");
                    setFeedback(null);
                  }}
                >
                  <SelectTrigger
                    id="recovery-destination-select"
                    data-testid="recovery-destination-select"
                  >
                    <SelectValue placeholder="Select a destination" />
                  </SelectTrigger>
                  <SelectContent>
                    {destinationOptions.map((destination) => (
                      <SelectItem
                        key={String(destination.id)}
                        value={String(destination.id)}
                        data-testid={`recovery-destination-option-${String(destination.id)}`}
                      >
                        {String(destination.name)} · {String(destination.provider)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>

              {plan.isLoading ? (
                <Skeleton className="h-40 w-full" data-testid="recovery-plan-loading" />
              ) : plan.isError ? (
                <div data-testid="recovery-plan-error">
                  <QueryErrorRetry
                    message={queryErrorMessage(plan.error, "Unable to load the recovery plan.")}
                    onRetry={() => void plan.refetch()}
                    isRetrying={plan.isFetching}
                  />
                </div>
              ) : plan.data ? (
                <RecoveryDetails
                  data={plan.data}
                  title={`Readiness for ${String(selectedDestination?.name ?? activeDestinationId)}`}
                />
              ) : null}

              <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                <Button
                  disabled={runRecovery.isPending || plan.data?.isReady !== true}
                  onClick={() => setConfirmOpen(true)}
                  data-testid="recovery-run-open-confirmation"
                >
                  {runRecovery.isPending ? "Creating bundle…" : "Create verified recovery bundle"}
                </Button>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Run control-plane recovery?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will create an encrypted bundle in{" "}
                      {String(selectedDestination?.name ?? activeDestinationId)} and start isolated
                      verification. It will not restore over production data.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel data-testid="recovery-run-cancel">Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => void handleRun()}
                      data-testid="recovery-run-confirm"
                    >
                      Confirm recovery run
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            </CardContent>
          </Card>

          <RecoveryBundleCatalog
            bundles={bundles}
            recentBundles={recentBundles}
            onSelect={setSelectedBundleId}
            selectedBundleId={selectedBundleId}
            selectedBundle={selectedBundle}
            selectedMetadata={selectedMetadata}
            onClose={() => setSelectedBundleId(null)}
          />
        </>
      )}
    </main>
  );
}
