import { useState } from "react";
import type { FormEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { validateResetPasswordFields } from "@/lib/auth-form-validation";
import { AlertCircle, ArrowLeft, CheckCircle2, Lock } from "lucide-react";

function getResetErrorMessage(errorCode: string | null) {
  if (errorCode === "INVALID_TOKEN") {
    return "This reset link is invalid or has expired. Request a new password reset email.";
  }

  return null;
}

export default function ResetPasswordPage() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get("token");
  const initialError = getResetErrorMessage(searchParams.get("error"));
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{
    newPassword?: string;
    confirmPassword?: string;
  }>({});
  const [feedback, setFeedback] = useState<string | null>(initialError);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    const nextErrors = validateResetPasswordFields({ newPassword, confirmPassword });
    setFieldErrors(nextErrors);
    setFeedback(null);

    if (Object.keys(nextErrors).length > 0) {
      return;
    }

    if (!token) {
      setFeedback("This reset link is invalid or has expired. Request a new password reset email.");
      return;
    }

    setLoading(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, newPassword })
      });

      if (!response.ok) {
        const data = (await response.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "Unable to reset your password.");
      }

      setComplete(true);
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Unable to reset your password.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-2 text-center">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm">
            <Lock size={24} className="text-primary" />
          </div>
          <CardTitle>Choose a New Password</CardTitle>
          <CardDescription>
            {complete
              ? "Your password has been reset. Sign in with the new password to continue."
              : "Set a new password for your DaoFlow account."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {complete ? (
            <div className="space-y-4 text-center">
              <Alert data-testid="reset-password-success">
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>Your password has been updated successfully.</AlertDescription>
              </Alert>
              <Link to="/login">
                <Button data-testid="reset-password-back-to-login">
                  <ArrowLeft size={14} className="mr-1" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form className="space-y-4" noValidate onSubmit={(event) => void handleSubmit(event)}>
              <div className="space-y-2">
                <Label htmlFor="reset-password-new">New Password</Label>
                <Input
                  id="reset-password-new"
                  type="password"
                  value={newPassword}
                  onChange={(event) => {
                    setNewPassword(event.target.value);
                    setFieldErrors((current) => ({ ...current, newPassword: undefined }));
                    setFeedback(initialError);
                  }}
                  aria-describedby={
                    fieldErrors.newPassword ? "reset-password-new-error" : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.newPassword)}
                  data-testid="reset-password-new"
                />
                {fieldErrors.newPassword ? (
                  <p
                    id="reset-password-new-error"
                    className="text-sm text-destructive"
                    data-testid="reset-password-new-error"
                  >
                    {fieldErrors.newPassword}
                  </p>
                ) : null}
              </div>

              <div className="space-y-2">
                <Label htmlFor="reset-password-confirm">Confirm New Password</Label>
                <Input
                  id="reset-password-confirm"
                  type="password"
                  value={confirmPassword}
                  onChange={(event) => {
                    setConfirmPassword(event.target.value);
                    setFieldErrors((current) => ({ ...current, confirmPassword: undefined }));
                    setFeedback(initialError);
                  }}
                  aria-describedby={
                    fieldErrors.confirmPassword ? "reset-password-confirm-error" : undefined
                  }
                  aria-invalid={Boolean(fieldErrors.confirmPassword)}
                  data-testid="reset-password-confirm"
                />
                {fieldErrors.confirmPassword ? (
                  <p
                    id="reset-password-confirm-error"
                    className="text-sm text-destructive"
                    data-testid="reset-password-confirm-error"
                  >
                    {fieldErrors.confirmPassword}
                  </p>
                ) : null}
              </div>

              {feedback ? (
                <Alert variant="destructive" data-testid="reset-password-feedback">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{feedback}</AlertDescription>
                </Alert>
              ) : null}

              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                data-testid="reset-password-submit"
              >
                {loading ? "Resetting…" : "Reset Password"}
              </Button>

              <p className="text-center text-sm text-muted-foreground">
                <Link to="/login" className="underline hover:text-foreground">
                  Back to Sign In
                </Link>
              </p>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
