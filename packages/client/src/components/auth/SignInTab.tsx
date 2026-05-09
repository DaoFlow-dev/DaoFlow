import { useState } from "react";
import type { FormEvent } from "react";
import { authClient, signIn } from "@/lib/auth-client";
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
import { AlertCircle, Eye, EyeOff, Loader2, ShieldCheck } from "lucide-react";

type AuthClientResult<TData> = {
  data?: TData | null;
  error?: {
    message?: string | null;
  } | null;
};

type SignInResult = AuthClientResult<{
  twoFactorRedirect?: boolean;
}>;

export function SignInTab({ onAuthenticated }: { onAuthenticated: () => Promise<void> | void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errors, setErrors] = useState<FieldErrors<SignInFieldName>>({});
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [mfaRequired, setMfaRequired] = useState(false);
  const [mfaCode, setMfaCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [trustDevice, setTrustDevice] = useState(false);

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
    const result = (await signIn.email({
      email: email.trim(),
      password
    })) as SignInResult;
    setLoading(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Sign-in failed.");
      return;
    }
    if (isTwoFactorRedirect(result.data)) {
      setMfaRequired(true);
      setFeedback(null);
      return;
    }
    await onAuthenticated();
  }

  async function handleMfaSubmit(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    const code = mfaCode.trim();
    if (!code) {
      setFeedback(useRecoveryCode ? "Enter a recovery code." : "Enter the six-digit code.");
      return;
    }

    setLoading(true);
    const result = useRecoveryCode
      ? await authClient.twoFactor.verifyBackupCode({ code, trustDevice })
      : await authClient.twoFactor.verifyTotp({ code, trustDevice });
    setLoading(false);

    if (result.error) {
      setFeedback(result.error.message ?? "Verification failed.");
      return;
    }

    await onAuthenticated();
  }

  if (mfaRequired) {
    return (
      <form
        className="mt-4 flex flex-col gap-4"
        noValidate
        onSubmit={(e) => void handleMfaSubmit(e)}
      >
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck size={16} className="text-primary" />
            <h3 className="text-sm font-medium">Verification required</h3>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Enter your authenticator code or one recovery code to finish signing in.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="signin-mfa-code">
            {useRecoveryCode ? "Recovery code" : "Authenticator code"}
          </Label>
          <Input
            id="signin-mfa-code"
            value={mfaCode}
            onChange={(e) => {
              setMfaCode(e.target.value);
              setFeedback(null);
            }}
            inputMode={useRecoveryCode ? "text" : "numeric"}
            autoComplete="one-time-code"
            data-testid="login-mfa-code"
          />
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={useRecoveryCode}
            onChange={(e) => {
              setUseRecoveryCode(e.target.checked);
              setMfaCode("");
              setFeedback(null);
            }}
            data-testid="login-mfa-use-recovery"
          />
          Use a recovery code
        </label>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={trustDevice}
            onChange={(e) => setTrustDevice(e.target.checked)}
            data-testid="login-mfa-trust-device"
          />
          Trust this device
        </label>

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
          data-testid="login-mfa-submit"
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Verifying…
            </>
          ) : (
            "Verify"
          )}
        </Button>
      </form>
    );
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
        {loading ? (
          <>
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Signing in…
          </>
        ) : (
          "Sign in"
        )}
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

function isTwoFactorRedirect(data: unknown): data is { twoFactorRedirect: true } {
  return Boolean(
    data &&
    typeof data === "object" &&
    "twoFactorRedirect" in data &&
    (data as { twoFactorRedirect?: unknown }).twoFactorRedirect === true
  );
}
