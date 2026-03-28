import { ShieldAlert } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface TerminalAccessNoticeProps {
  serviceName: string;
  isCheckingAccess: boolean;
}

export default function TerminalAccessNotice({
  serviceName,
  isCheckingAccess
}: TerminalAccessNoticeProps) {
  return (
    <Card className="shadow-sm" data-testid="terminal-access-card">
      <CardHeader>
        <CardTitle className="text-base">Interactive terminal access</CardTitle>
        <CardDescription>
          DaoFlow keeps shell access separate from normal deploy and log permissions.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isCheckingAccess ? (
          <div className="space-y-3" data-testid="terminal-access-loading">
            <Skeleton className="h-5 w-56 rounded-xl" />
            <Skeleton className="h-20 w-full rounded-xl" />
          </div>
        ) : (
          <>
            <Alert
              className="border-amber-500/40 bg-amber-500/5"
              data-testid="terminal-access-blocked-alert"
            >
              <ShieldAlert size={16} className="text-amber-600 dark:text-amber-300" />
              <AlertTitle>Terminal access needs a separate permission.</AlertTitle>
              <AlertDescription>
                You can still inspect logs and deployments for {serviceName}, but DaoFlow only opens
                an interactive shell for principals that include{" "}
                <code className="rounded bg-muted px-1 py-0.5 text-xs">terminal:open</code>.
              </AlertDescription>
            </Alert>
            <p className="text-sm text-muted-foreground" data-testid="terminal-access-help">
              Ask an owner to handle break-glass troubleshooting when a live shell is required.
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
