import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface GeneralSettingsTabProps {
  currentRole: string;
  email: string | undefined;
  sessionExpiresAt: string | null | undefined;
  caps: readonly string[];
}

export function GeneralSettingsTab({
  currentRole,
  email,
  sessionExpiresAt,
  caps
}: GeneralSettingsTabProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">General Settings</CardTitle>
          <CardDescription>Platform information and system status.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Platform</p>
              <p className="text-sm font-medium">DaoFlow v0.1.0</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Your Role</p>
              <p className="text-sm font-medium capitalize">{currentRole}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Email</p>
              <p className="text-sm font-medium">{email ?? "—"}</p>
            </div>
            <div className="rounded-lg border p-3">
              <p className="text-xs text-muted-foreground">Session Expires</p>
              <p className="text-sm font-medium">
                {sessionExpiresAt ? new Date(sessionExpiresAt).toLocaleString() : "—"}
              </p>
            </div>
          </div>

          <div>
            <p className="mb-2 text-xs text-muted-foreground">Granted Scopes ({caps.length})</p>
            <div className="flex flex-wrap gap-1.5">
              {caps.map((scope) => (
                <Badge key={scope} variant="secondary" className="text-xs">
                  {scope}
                </Badge>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
