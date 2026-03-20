import { useState } from "react";
import type { FormEvent } from "react";
import { signUp } from "@/lib/auth-client";
import {
  type FieldErrors,
  type SignUpFieldName,
  validateSignUpFields
} from "@/lib/auth-form-validation";
import { SetupStepIndicator } from "@/components/SetupStepIndicator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { AuthFieldError } from "@/components/auth/AuthFieldError";
import { AlertCircle, Eye, EyeOff } from "lucide-react";

function getPasswordStrength(password: string): { score: number; label: string; color: string } {
  let score = 0;
  if (password.length >= 8) score++;
  if (password.length >= 12) score++;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score++;
  if (/[0-9]/.test(password)) score++;
  if (/[^a-zA-Z0-9]/.test(password)) score++;

  if (score <= 1) return { score, label: "Weak", color: "bg-red-500" };
  if (score <= 3) return { score, label: "Fair", color: "bg-amber-500" };
  return { score, label: "Strong", color: "bg-emerald-500" };
}

export function SignUpTab({ onAuthenticated }: { onAuthenticated: () => Promise<void> | void }) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<SignUpFieldName>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  function clearFieldError(fieldName: SignUpFieldName) {
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
    const nextErrors = validateSignUpFields({ name, email, password });
    setErrors(nextErrors);
    setFeedback(null);
    if (Object.keys(nextErrors).length > 0) {
      return;
    }
    setLoading(true);
    const result = await signUp.email({
      name: name.trim(),
      email: email.trim(),
      password
    });
    setLoading(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Sign-up failed.");
      return;
    }
    await onAuthenticated();
  }

  const strength = password.length > 0 ? getPasswordStrength(password) : null;

  return (
    <>
      <SetupStepIndicator
        steps={[
          { label: "Create Account", completed: false, active: true },
          { label: "Configure Server", completed: false, active: false },
          { label: "Deploy", completed: false, active: false }
        ]}
      />
      <form className="mt-4 flex flex-col gap-4" noValidate onSubmit={(e) => void handleSubmit(e)}>
        <div className="space-y-2">
          <Label htmlFor="signup-name">Name</Label>
          <Input
            id="signup-name"
            placeholder="Your name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              clearFieldError("name");
              setFeedback(null);
            }}
            aria-describedby={errors.name ? "signup-name-error" : undefined}
            aria-invalid={Boolean(errors.name)}
            data-testid="login-signup-name"
          />
          <AuthFieldError
            id="signup-name-error"
            message={errors.name}
            testId="login-signup-name-error"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-email">Email</Label>
          <Input
            id="signup-email"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              clearFieldError("email");
              setFeedback(null);
            }}
            aria-describedby={errors.email ? "signup-email-error" : undefined}
            aria-invalid={Boolean(errors.email)}
            data-testid="login-signup-email"
          />
          <AuthFieldError
            id="signup-email-error"
            message={errors.email}
            testId="login-signup-email-error"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="signup-password">Password</Label>
          <div className="relative">
            <Input
              id="signup-password"
              type={showPassword ? "text" : "password"}
              placeholder="••••••••"
              value={password}
              onChange={(e) => {
                setPassword(e.target.value);
                clearFieldError("password");
                setFeedback(null);
              }}
              aria-describedby={errors.password ? "signup-password-error" : undefined}
              aria-invalid={Boolean(errors.password)}
              data-testid="login-signup-password"
            />
            <button
              type="button"
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              onClick={() => setShowPassword((currentValue) => !currentValue)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              data-testid="login-signup-password-toggle"
            >
              {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <AuthFieldError
            id="signup-password-error"
            message={errors.password}
            testId="login-signup-password-error"
          />
          {strength ? (
            <div className="space-y-1.5">
              <div className="flex gap-1">
                {[1, 2, 3, 4, 5].map((i) => (
                  <div
                    key={i}
                    className={`h-1.5 flex-1 rounded-full transition-all duration-300 ${
                      i <= strength.score ? strength.color : "bg-muted"
                    }`}
                  />
                ))}
              </div>
              <p className="text-xs font-medium text-muted-foreground">{strength.label}</p>
            </div>
          ) : null}
        </div>
        {feedback ? (
          <Alert variant="destructive" data-testid="login-signup-feedback">
            <AlertCircle className="h-4 w-4" />
            <AlertDescription>{feedback}</AlertDescription>
          </Alert>
        ) : null}
        <Button
          type="submit"
          className="w-full shadow-sm"
          disabled={loading}
          data-testid="login-signup-submit"
        >
          {loading ? "Creating account…" : "Create account"}
        </Button>
      </form>
    </>
  );
}
