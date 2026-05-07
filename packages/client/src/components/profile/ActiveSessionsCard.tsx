import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock, Loader2 } from "lucide-react";

type ActiveSessionsCardProps = {
  isRevokingOtherSessions: boolean;
  onRevokeOtherSessions: () => void;
};

function getBrowserName() {
  if (navigator.userAgent.includes("Chrome")) {
    return "Chrome";
  }
  if (navigator.userAgent.includes("Firefox")) {
    return "Firefox";
  }
  if (navigator.userAgent.includes("Safari")) {
    return "Safari";
  }
  return "Browser";
}

export function ActiveSessionsCard({
  isRevokingOtherSessions,
  onRevokeOtherSessions
}: ActiveSessionsCardProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Clock size={16} />
          Active Sessions
        </CardTitle>
        <CardDescription>Manage your active login sessions.</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <p className="text-sm font-medium">Current session</p>
            <p className="text-xs text-muted-foreground">{getBrowserName()} · Last active now</p>
          </div>
          <Badge variant="default">Active</Badge>
        </div>
        <div className="mt-4 flex gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isRevokingOtherSessions}
            onClick={onRevokeOtherSessions}
            data-testid="active-sessions-revoke-other"
          >
            {isRevokingOtherSessions && <Loader2 size={14} className="mr-1 animate-spin" />}
            Revoke all other sessions
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
