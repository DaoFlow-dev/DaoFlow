import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { signIn, signUp, useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Hexagon, Eye, EyeOff } from "lucide-react";
import { useEffect } from "react";
import { SetupStepIndicator } from "@/components/SetupStepIndicator";

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

export default function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  const requestedReturnTo = searchParams.get("returnTo");
  const returnTo =
    requestedReturnTo && requestedReturnTo.startsWith("/") && !requestedReturnTo.startsWith("//")
      ? requestedReturnTo
      : "/";

  // Redirect if already signed in
  useEffect(() => {
    if (session.data) {
      void navigate(returnTo, { replace: true });
    }
  }, [navigate, returnTo, session.data]);

  async function handleSignUp(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLoading(true);
    const result = await signUp.email({ name, email, password });
    setLoading(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Sign-up failed.");
      return;
    }
    await session.refetch();
  }

  async function handleSignIn(e: FormEvent) {
    e.preventDefault();
    setFeedback(null);
    setLoading(true);
    const result = await signIn.email({ email, password });
    setLoading(false);
    if (result.error) {
      setFeedback(result.error.message ?? "Sign-in failed.");
      return;
    }
    await session.refetch();
  }

  return (
    <div className="login-page">
      <div className="login-page__container">
        {/* Logo */}
        <div className="login-page__logo">
          <Hexagon size={40} strokeWidth={1.5} />
          <h1>DaoFlow</h1>
        </div>
        <p className="login-page__tagline">
          The agentic platform to host deterministic systems — from one prompt to production.
        </p>

        <Card className="login-page__card">
          <CardHeader className="text-center">
            <h2 className="text-xl font-semibold leading-none tracking-tight">Welcome</h2>
            <CardDescription>Sign in to your account or create a new one</CardDescription>
          </CardHeader>
          <CardContent>
            <Tabs defaultValue="sign-in">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="sign-in">Sign in</TabsTrigger>
                <TabsTrigger value="sign-up">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="sign-in">
                <form className="login-page__form" onSubmit={(e) => void handleSignIn(e)}>
                  <div className="space-y-2">
                    <Label htmlFor="signin-email">Email</Label>
                    <Input
                      id="signin-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
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
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                        aria-label={showPassword ? "Hide password" : "Show password"}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                  <p className="text-center text-sm text-muted-foreground">
                    <a href="/forgot-password" className="underline hover:text-foreground">
                      Forgot your password?
                    </a>
                  </p>
                </form>
              </TabsContent>

              <TabsContent value="sign-up">
                <SetupStepIndicator
                  steps={[
                    { label: "Create Account", completed: false, active: true },
                    { label: "Configure Server", completed: false, active: false },
                    { label: "Deploy", completed: false, active: false }
                  ]}
                />
                <form className="login-page__form" onSubmit={(e) => void handleSignUp(e)}>
                  <div className="space-y-2">
                    <Label htmlFor="signup-name">Name</Label>
                    <Input
                      id="signup-name"
                      placeholder="Your name"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-email">Email</Label>
                    <Input
                      id="signup-email"
                      type="email"
                      placeholder="you@example.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
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
                        onChange={(e) => setPassword(e.target.value)}
                        required
                      />
                      <button
                        type="button"
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowPassword(!showPassword)}
                      >
                        {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                      </button>
                    </div>
                    {password.length > 0 &&
                      (() => {
                        const strength = getPasswordStrength(password);
                        return (
                          <div className="space-y-1">
                            <div className="flex gap-1">
                              {[1, 2, 3, 4, 5].map((i) => (
                                <div
                                  key={i}
                                  className={`h-1 flex-1 rounded-full transition-colors ${
                                    i <= strength.score ? strength.color : "bg-muted"
                                  }`}
                                />
                              ))}
                            </div>
                            <p className="text-xs text-muted-foreground">{strength.label}</p>
                          </div>
                        );
                      })()}
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Creating account…" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>

            {feedback && (
              <Alert variant="destructive" className="mt-4">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{feedback}</AlertDescription>
              </Alert>
            )}
          </CardContent>
        </Card>

        <p className="login-page__footer">
          Open-source Agentic DevOps System — from prompts to production.
        </p>
      </div>
    </div>
  );
}
