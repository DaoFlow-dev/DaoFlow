import { Button } from "@/components/ui/button";
import { AlertCircle, RefreshCw } from "lucide-react";

interface QueryErrorRetryProps {
  message?: string;
  onRetry: () => void;
  isRetrying?: boolean;
}

/**
 * Reusable error state shown when a tRPC query fails.
 * Provides a retry button to refetch. (F1)
 */
export function QueryErrorRetry({ message, onRetry, isRetrying }: QueryErrorRetryProps) {
  return (
    <div className="flex flex-col items-center gap-3 py-12 text-center" role="alert">
      <AlertCircle size={32} className="text-destructive" />
      <p className="text-sm text-muted-foreground">
        {message ?? "Something went wrong. Please try again."}
      </p>
      <Button variant="outline" size="sm" onClick={onRetry} disabled={isRetrying}>
        <RefreshCw size={14} className={`mr-1 ${isRetrying ? "animate-spin" : ""}`} />
        Retry
      </Button>
    </div>
  );
}
