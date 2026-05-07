import { useState } from "react";
import { authClient } from "@/lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

export type MfaRequirement = "optional" | "privileged" | "all";

function isMfaRequirement(value: unknown): value is MfaRequirement {
  return value === "optional" || value === "privileged" || value === "all";
}

export interface AccountSecurityStatus {
  policy: {
    mfaRequirement: MfaRequirement;
  };
  user: {
    twoFactorEnabled: boolean;
    mfaRequired: boolean;
    mfaSatisfied: boolean;
    recoveryCodesConfigured: boolean;
  };
}

interface MfaSettingsCardProps {
  accountSecurity: AccountSecurityStatus | null;
  policyPending: boolean;
  onPolicyChange: (mfaRequirement: MfaRequirement) => void;
  onSecurityRefresh: () => void;
}

export function MfaSettingsCard({
  accountSecurity,
  policyPending,
  onPolicyChange,
  onSecurityRefresh
}: MfaSettingsCardProps) {
  const [password, setPassword] = useState("");
  const [totpCode, setTotpCode] = useState("");
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);

  async function startEnrollment() {
    setActionPending(true);
    setFeedback(null);
    setBackupCodes([]);
    const result = await authClient.twoFactor.enable({ password, issuer: "DaoFlow" });
    setActionPending(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Could not start MFA enrollment.");
      return;
    }
    setBackupCodes(result.data?.backupCodes ?? []);
    setFeedback("Scan the authenticator URI, then enter the generated code to finish enrollment.");
  }

  async function verifyEnrollment() {
    setActionPending(true);
    setFeedback(null);
    const result = await authClient.twoFactor.verifyTotp({ code: totpCode.trim() });
    setActionPending(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Could not verify the code.");
      return;
    }
    setPassword("");
    setTotpCode("");
    setFeedback("MFA is enabled.");
    onSecurityRefresh();
  }

  async function disableMfa() {
    setActionPending(true);
    setFeedback(null);
    const result = await authClient.twoFactor.disable({ password });
    setActionPending(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Could not disable MFA.");
      return;
    }
    setPassword("");
    setBackupCodes([]);
    setFeedback("MFA is disabled.");
    onSecurityRefresh();
  }

  async function rotateRecoveryCodes() {
    setActionPending(true);
    setFeedback(null);
    const result = await authClient.twoFactor.generateBackupCodes({ password });
    setActionPending(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Could not generate recovery codes.");
      return;
    }
    setBackupCodes(result.data?.backupCodes ?? []);
    setPassword("");
    setFeedback("New recovery codes generated.");
    onSecurityRefresh();
  }

  return (
    <Card data-testid="security-mfa-card">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">Multi-factor authentication</CardTitle>
            <CardDescription>TOTP enrollment, recovery codes, and role policy.</CardDescription>
          </div>
          <Badge variant={accountSecurity?.user.twoFactorEnabled ? "default" : "secondary"}>
            {accountSecurity?.user.twoFactorEnabled ? "Enabled" : "Not enabled"}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Policy</p>
            <p className="text-sm font-medium capitalize">
              {accountSecurity?.policy.mfaRequirement ?? "optional"}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Required for you</p>
            <p className="text-sm font-medium">
              {accountSecurity?.user.mfaRequired ? "Yes" : "No"}
            </p>
          </div>
          <div className="rounded-lg border p-3">
            <p className="text-xs text-muted-foreground">Recovery codes</p>
            <p className="text-sm font-medium">
              {accountSecurity?.user.recoveryCodesConfigured ? "Configured" : "Not configured"}
            </p>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="security-mfa-policy">Team MFA policy</Label>
            <Select
              value={accountSecurity?.policy.mfaRequirement ?? "optional"}
              onValueChange={(value) => {
                if (isMfaRequirement(value)) {
                  onPolicyChange(value);
                }
              }}
            >
              <SelectTrigger id="security-mfa-policy" data-testid="security-mfa-policy">
                <SelectValue placeholder="Choose policy" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="optional">Optional</SelectItem>
                <SelectItem value="privileged">Required for privileged roles</SelectItem>
                <SelectItem value="all">Required for all human users</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={policyPending}
            onClick={onSecurityRefresh}
            data-testid="security-mfa-refresh"
          >
            Refresh
          </Button>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="security-mfa-password">Password</Label>
            <Input
              id="security-mfa-password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              data-testid="security-mfa-password"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="security-mfa-code">Authenticator code</Label>
            <Input
              id="security-mfa-code"
              inputMode="numeric"
              value={totpCode}
              onChange={(event) => setTotpCode(event.target.value)}
              data-testid="security-mfa-code"
            />
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            disabled={actionPending || !password}
            onClick={() => void startEnrollment()}
            data-testid="security-mfa-enroll"
          >
            Enroll
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={actionPending || !totpCode}
            onClick={() => void verifyEnrollment()}
            data-testid="security-mfa-verify"
          >
            Verify code
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={actionPending || !password}
            onClick={() => void rotateRecoveryCodes()}
            data-testid="security-mfa-rotate-codes"
          >
            Rotate recovery codes
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={actionPending || !password}
            onClick={() => void disableMfa()}
            data-testid="security-mfa-disable"
          >
            Disable
          </Button>
        </div>

        {feedback ? (
          <p className="text-sm text-muted-foreground" data-testid="security-mfa-feedback">
            {feedback}
          </p>
        ) : null}

        {backupCodes.length > 0 ? (
          <div className="rounded-lg border bg-muted/30 p-3" data-testid="security-backup-codes">
            <p className="text-sm font-medium">Recovery codes</p>
            <div className="mt-2 grid gap-1 sm:grid-cols-2">
              {backupCodes.map((code) => (
                <code key={code} className="rounded bg-background px-2 py-1 text-xs">
                  {code}
                </code>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
