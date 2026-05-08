import { AlertCircle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";

export interface DashboardQueryIssue {
  key: string;
  title: string;
  message: string;
  isRetrying?: boolean;
  onRetry: () => void;
}

export function DashboardQueryAlerts({ issues }: { issues: DashboardQueryIssue[] }) {
  if (issues.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="dashboard-query-errors">
      {issues.map((issue) => (
        <Alert
          key={issue.key}
          variant="destructive"
          data-testid={`dashboard-query-error-${issue.key}`}
        >
          <AlertCircle className="h-4 w-4" />
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <AlertTitle>{issue.title}</AlertTitle>
              <AlertDescription>{issue.message}</AlertDescription>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={issue.onRetry}
              disabled={issue.isRetrying}
              className="w-fit shrink-0"
              data-testid={`dashboard-query-retry-${issue.key}`}
            >
              <RefreshCw className={`mr-1.5 h-4 w-4 ${issue.isRetrying ? "animate-spin" : ""}`} />
              Retry
            </Button>
          </div>
        </Alert>
      ))}
    </div>
  );
}
