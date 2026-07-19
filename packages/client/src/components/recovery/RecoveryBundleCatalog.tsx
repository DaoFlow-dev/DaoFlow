import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { QueryErrorRetry } from "@/components/QueryErrorRetry";
import type {
  RecoveryBundle,
  RecoveryMetadata,
  RecoveryQueryState
} from "@/features/recovery/types";
import { queryErrorMessage } from "@/lib/query-error-message";
import { RecoveryDetails } from "./RecoveryDetails";

function statusVariant(status: string): "success" | "destructive" | "secondary" | "outline" {
  if (status === "verified") return "success";
  if (status === "failed") return "destructive";
  if (status === "queued" || status === "running") return "secondary";
  return "outline";
}

export function RecoveryBundleCatalog({
  bundles,
  recentBundles,
  onSelect,
  selectedBundleId,
  selectedBundle,
  selectedMetadata,
  onClose
}: {
  bundles: RecoveryQueryState<unknown>;
  recentBundles: RecoveryBundle[];
  onSelect: (bundleId: string) => void;
  selectedBundleId: string | null;
  selectedBundle: RecoveryQueryState<RecoveryBundle>;
  selectedMetadata: RecoveryQueryState<RecoveryMetadata>;
  onClose: () => void;
}) {
  return (
    <>
      <Card data-testid="recovery-recent-bundles">
        <CardHeader>
          <CardTitle className="text-base">Recent recovery bundles</CardTitle>
          <CardDescription>
            Inspect verification evidence and safe metadata. Secrets and keys are never displayed.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {bundles.isLoading ? (
            <Skeleton className="h-24 w-full" data-testid="recovery-bundles-loading" />
          ) : bundles.isError ? (
            <div data-testid="recovery-bundles-error">
              <QueryErrorRetry
                message={queryErrorMessage(bundles.error, "Unable to load recovery bundles.")}
                onRetry={() => void bundles.refetch()}
                isRetrying={bundles.isFetching}
              />
            </div>
          ) : recentBundles.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid="recovery-bundles-empty">
              No recovery bundles have been created yet.
            </p>
          ) : (
            recentBundles.map((bundle) => (
              <div
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3"
                key={bundle.id}
                data-testid={`recovery-bundle-${bundle.id}`}
              >
                <div className="flex min-w-0 flex-col gap-1">
                  <span
                    className="font-mono text-xs"
                    data-testid={`recovery-bundle-id-${bundle.id}`}
                  >
                    {bundle.id}
                  </span>
                  <span
                    className="text-xs text-muted-foreground"
                    data-testid={`recovery-bundle-created-${bundle.id}`}
                  >
                    {bundle.createdAt ?? "Created time unavailable"}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Badge
                    variant={statusVariant(bundle.status)}
                    data-testid={`recovery-bundle-status-${bundle.id}`}
                  >
                    {bundle.status}
                  </Badge>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onSelect(bundle.id)}
                    data-testid={`recovery-bundle-inspect-${bundle.id}`}
                  >
                    Inspect metadata
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>

      {selectedBundleId ? (
        <div className="flex flex-col gap-4" data-testid="recovery-selected-bundle">
          {selectedBundle.isLoading ? (
            <Skeleton className="h-48 w-full" data-testid="recovery-inspect-loading" />
          ) : null}
          {selectedBundle.isError ? (
            <div data-testid="recovery-inspect-error">
              <QueryErrorRetry
                message={queryErrorMessage(
                  selectedBundle.error,
                  "Unable to load recovery bundle details."
                )}
                onRetry={() => void selectedBundle.refetch()}
                isRetrying={selectedBundle.isFetching}
              />
            </div>
          ) : selectedBundle.data ? (
            <RecoveryDetails data={selectedBundle.data} title={`Bundle ${selectedBundleId}`} />
          ) : null}
          {selectedMetadata.isLoading ? (
            <Skeleton className="h-32 w-full" data-testid="recovery-metadata-loading" />
          ) : null}
          {selectedMetadata.isError ? (
            <div data-testid="recovery-metadata-error">
              <QueryErrorRetry
                message={queryErrorMessage(
                  selectedMetadata.error,
                  "Unable to load recovery metadata."
                )}
                onRetry={() => void selectedMetadata.refetch()}
                isRetrying={selectedMetadata.isFetching}
              />
            </div>
          ) : selectedMetadata.data ? (
            <RecoveryDetails data={selectedMetadata.data} title="Downloadable recovery metadata" />
          ) : null}
          <Button variant="outline" onClick={onClose} data-testid="recovery-inspect-close">
            Close inspection
          </Button>
        </div>
      ) : null}
    </>
  );
}
