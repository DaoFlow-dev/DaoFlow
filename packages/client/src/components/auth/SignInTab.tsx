import { useState } from "react";
import type { FormEvent } from "react";
import { signIn } from "@/lib/auth-client";
import {
  type FieldErrors,
  type SignInFieldName,
  validateSignInFields
} from "@/lib/auth-form-validation";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthFieldError } from "@/components/auth/AuthFieldError";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

export function SignInTab({ onAuthenticated }: { onAuthenticated: () => Promise<void> | void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<SignInFieldName>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function clearFieldError(fieldName: SignInFieldName) {
    setErrors((currentErrors) => {
      if (!currentErrors[fieldName]) {
        return currentErrors;
      }
      const nextErrors = { ...currentErrors };
      delete nextErrors[fieldName];
      return nextErrors;
    });
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const nextErrors = validateSignInFields({ email, password });
    setErrors(nextErrors);
    setFeedback(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    setLoading(true);
    const result = await signIn.email({
      email: email.trim(),
      password
    });
    setLoading(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Sign-in failed.");
      return;
    }
    await onAuthenticated();
  }

  return (
    <form className="mt-4 flex flex-col gap-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
      <div className="space-y-2">
        <Label htmlFor="signin-email">Email</Label>
        <Input
          id="signin-email"
          type="email"
          placeholder="you@example.com"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            clearFieldError("email");
            setFeedback(null);
          }}
          aria-describedby={errors.email ? "signin-email-error" : undefined}
          aria-invalid={Boolean(errors.email)}
          data-testid="login-signin-email"
        />
        <AuthFieldError
          id="signin-email-error"
          message={errors.email}
          testId="login-signin-email-error"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-password">Password</Label>
        <div className="relative">
          <Input
            id="signin-password"
            type={showPassword ? "text" : "password"}
            placeholder="••••••••"
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              clearFieldError("password");
              setFeedback(null);
            }}
            aria-describedby={errors.password ? "signin-password-error" : undefined}
            aria-invalid={Boolean(errors.password)}
            data-testid="login-signin-password"
          />
          <button
            type="button"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            onClick={() => setShowPassword((currentValue) => !currentValue)}
            aria-label={showPassword ? "Hide characters" : "Show characters"}
            data-testid="login-signin-password-toggle"
          >
            {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        <AuthFieldError
          id="signin-password-error"
          message={errors.password}
          testId="login-signin-password-error"
        />
      </div>
      {feedback ? (
        <Alert variant="destructive" data-testid="login-signin-feedback">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{feedback}</AlertDescription>
        </Alert>
      ) : null}
      <Button
        type="submit"
        className="w-full shadow-sm"
        disabled={loading}
        data-testid="login-signin-submit"
      >
        {loading ? "Signing in…" : "Sign in"}
      </Button>
      <p className="text-center text-sm">
        <a
          href="/forgot-password"
          className="text-muted-foreground transition-colors hover:text-foreground"
        >
          Forgot your password?
        </a>
      </p>
    </form>
  );
}
