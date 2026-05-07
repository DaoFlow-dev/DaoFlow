import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Smartphone } from "lucide-react";
import type { AccountSecurityStatus } from "@/components/settings/MfaSettingsCard";

interface MfaStatusCardProps {
  accountSecurity: AccountSecurityStatus | null;
  isLoading: boolean;
  onManageMfa: () => void;
}

export function MfaStatusCard({ accountSecurity, isLoading, onManageMfa }: MfaStatusCardProps) {
  const enabled = accountSecurity?.user.twoFactorEnabled ?? false;
  const status = isLoading ? "Checking" : enabled ? "Enabled" : "Not enabled";

  return (
    <Card data-testid="profile-mfa-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base flex items-center gap-2">
              <Smartphone size={16} />
              Two-Factor Authentication
            </CardTitle>
            <CardDescription>Add an extra layer of security to your account.</CardDescription>
          </div>
          <Badge variant={enabled ? "default" : "secondary"} data-testid="profile-mfa-status">
            {status}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3" data-testid="profile-mfa-required">
            <p className="text-xs text-muted-foreground">Required for you</p>
            <p className="text-sm font-medium">
              {accountSecurity?.user.mfaRequired ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-lg border p-3" data-testid="profile-mfa-recovery-codes">
            <p className="text-xs text-muted-foreground">Recovery codes</p>
            <p className="text-sm font-medium">
              {accountSecurity?.user.recoveryCodesConfigured ? "Configured" : "Not configured"}
            </p>
          </div>
          <div className="rounded-lg border p-3" data-testid="profile-mfa-policy">
            <p className="text-xs text-muted-foreground">Team policy</p>
            <p className="text-sm font-medium capitalize">
              {accountSecurity?.policy.mfaRequirement ?? "optional"}
            </p>
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="profile-mfa-manage"
            onClick={onManageMfa}
          >
            Manage MFA
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
