import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { signIn, signUp, useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertCircle, Hexagon } from "lucide-react";
import { useEffect } from "react";

export default function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [feedback, setFeedback] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Redirect if already signed in
  useEffect(() => {
    if (session.data) {
      void navigate("/", { replace: true });
    }
  }, [session.data, navigate]);

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
                    <Input
                      id="signin-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="sign-up">
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
                    <Input
                      id="signup-password"
                      type="password"
                      placeholder="••••••••"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      required
                    />
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
          Deterministic hosting that humans and agents can trust.
        </p>
      </div>
    </div>
  );
}
