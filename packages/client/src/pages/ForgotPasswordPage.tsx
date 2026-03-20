import { useState } from "react";
import type { FormEvent } from "react";
import { Link } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { validateForgotPasswordFields } from "@/lib/auth-form-validation";
import { ArrowLeft, CheckCircle2, Mail } from "lucide-react";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [sent, setSent] = useState(false);
  const [emailError, setEmailError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validateForgotPasswordFields({ email });
    setEmailError(nextErrors.email ?? null);
    setFeedback(null);
    if (nextErrors.email) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forget-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), redirectTo: "/reset-password" })
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { message?: string };
        throw new Error(data.message ?? "Failed to send reset email.");
      }
      setSent(true);
    } catch (err) {
      setFeedback(err instanceof Error ? err.message : "Unable to send reset email.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="flex min-h-[80vh] items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center space-y-2">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 shadow-sm">
            <Mail size={24} className="text-primary" />
          </div>
          <CardTitle>Reset Password</CardTitle>
          <CardDescription>
            {sent
              ? "Check your email for a password reset link."
              : "Enter your email and we'll send you a reset link."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {sent ? (
            <div className="space-y-4 text-center">
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertDescription>
                  If an account with that email exists, a reset link has been sent.
                </AlertDescription>
              </Alert>
              <Link to="/login">
                <Button variant="outline">
                  <ArrowLeft size={14} className="mr-1" />
                  Back to Sign In
                </Button>
              </Link>
            </div>
          ) : (
            <form className="space-y-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
              <div className="space-y-2">
                <Label htmlFor="reset-email">Email</Label>
                <Input
                  id="reset-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError(null);
                    setFeedback(null);
                  }}
                  aria-describedby={emailError ? "reset-email-error" : undefined}
                  aria-invalid={Boolean(emailError)}
                  data-testid="forgot-password-email"
                />
                {emailError ? (
                  <p
                    id="reset-email-error"
                    className="text-sm text-destructive"
                    data-testid="forgot-password-email-error"
                  >
                    {emailError}
                  </p>
                ) : null}
              </div>
              {feedback ? (
                <Alert variant="destructive" data-testid="forgot-password-feedback">
                  <AlertDescription>{feedback}</AlertDescription>
                </Alert>
              ) : null}
              <Button
                type="submit"
                className="w-full"
                disabled={loading}
                data-testid="forgot-password-submit"
              >
                {loading ? "Sending…" : "Send Reset Link"}
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
