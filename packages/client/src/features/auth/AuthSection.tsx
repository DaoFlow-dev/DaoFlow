import { useState } from "react";
import type { FormEvent } from "react";
import { signIn, signOut, signUp } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

interface SessionData {
  user: { email: string; name: string };
}

interface ViewerData {
  authz: { role: string; capabilities: readonly string[] };
}

export interface AuthSectionProps {
  session: { data: SessionData | null; refetch: () => Promise<unknown> };
  viewer: { data?: ViewerData | null; refetch: () => Promise<{ data?: ViewerData | null }> };
  adminControlPlane: {
    data?: unknown;
    error?: unknown;
    refetch: () => Promise<unknown>;
  };
  agentTokenInventory: { refetch: () => Promise<unknown> };
  currentRole: string;
  viewerMessage: string | null;
  adminMessage: string | null;
  onSignOut: () => void;
}

export function AuthSection({
  session,
  viewer,
  adminControlPlane,
  agentTokenInventory,
  currentRole,
  viewerMessage,
  adminMessage,
  onSignOut
}: AuthSectionProps) {
  const [authMode, setAuthMode] = useState<"sign-in" | "sign-up">("sign-up");
  const [name, setName] = useState("DaoFlow Operator");
  const [email, setEmail] = useState("operator@daoflow.local");
  const [password, setPassword] = useState("secret1234");
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);

  async function handleSignUp(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthFeedback(null);

    const result = await signUp.email({
      name,
      email,
      password
    });

    if (result.error) {
      setAuthFeedback(result.error.message ?? "Sign-up failed.");
      return;
    }

    await session.refetch();
    const viewerResponse = await viewer.refetch();
    await adminControlPlane.refetch();
    const nextRole = viewerResponse.data?.authz.role;

    if (nextRole === "owner" || nextRole === "admin") {
      await agentTokenInventory.refetch();
    }
    setAuthFeedback("Account created and session established.");
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setAuthFeedback(null);

    const result = await signIn.email({
      email,
      password
    });

    if (result.error) {
      setAuthFeedback(result.error.message ?? "Sign-in failed.");
      return;
    }

    await session.refetch();
    const viewerResponse = await viewer.refetch();
    await adminControlPlane.refetch();
    const nextRole = viewerResponse.data?.authz.role;

    if (nextRole === "owner" || nextRole === "admin") {
      await agentTokenInventory.refetch();
    }
    setAuthFeedback("Signed in successfully.");
  }

  async function handleSignOut() {
    await signOut();
    await session.refetch();
    setAuthFeedback("Signed out.");
    onSignOut();
  }

  return (
    <section className="grid gap-6 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1fr)]">
      <Card className="border-border/60">
        <CardHeader className="gap-4">
          <div className="space-y-1">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
              Auth slice
            </p>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              Better Auth + protected tRPC
            </h2>
          </div>
          <div className="inline-flex w-fit rounded-lg border border-border/60 bg-muted/40 p-1">
            <Button
              data-testid="auth-mode-sign-up"
              onClick={() => setAuthMode("sign-up")}
              size="sm"
              type="button"
              variant={authMode === "sign-up" ? "default" : "ghost"}
            >
              Sign up
            </Button>
            <Button
              data-testid="auth-mode-sign-in"
              onClick={() => setAuthMode("sign-in")}
              size="sm"
              type="button"
              variant={authMode === "sign-in" ? "default" : "ghost"}
            >
              Sign in
            </Button>
          </div>
        </CardHeader>

        <CardContent className="space-y-4">
          {!session.data ? (
            <form
              className="space-y-4"
              onSubmit={(event) => {
                void (authMode === "sign-up" ? handleSignUp(event) : handleSignIn(event));
              }}
            >
              {authMode === "sign-up" ? (
                <label className="grid gap-2 text-sm font-medium text-foreground">
                  <span>Name</span>
                  <Input
                    data-testid="auth-input-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                  />
                </label>
              ) : null}

              <label className="grid gap-2 text-sm font-medium text-foreground">
                <span>Email</span>
                <Input
                  data-testid="auth-input-email"
                  type="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>

              <label className="grid gap-2 text-sm font-medium text-foreground">
                <span>Password</span>
                <Input
                  data-testid="auth-input-password"
                  type="password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>

              <Button className="w-full" data-testid="auth-submit" type="submit">
                {authMode === "sign-up" ? "Create account" : "Sign in"}
              </Button>
            </form>
          ) : (
            <div className="space-y-4">
              <div className="rounded-xl border border-border/60 bg-muted/25 p-4 text-sm text-muted-foreground">
                <p className="font-medium text-foreground" data-testid="auth-summary">
                  Signed in as <strong>{session.data.user.email}</strong>.
                </p>
                <p className="mt-2" data-testid="auth-role">
                  Assigned role: <strong>{currentRole}</strong>
                </p>
              </div>
              <Button
                data-testid="auth-sign-out"
                onClick={() => {
                  void handleSignOut();
                }}
                type="button"
                variant="outline"
              >
                Sign out
              </Button>
            </div>
          )}

          {authFeedback ? (
            <p className="rounded-xl border border-border/60 bg-muted/25 px-3 py-2 text-sm text-muted-foreground">
              {authFeedback}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
            Protected procedure
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">Viewer</h2>
        </CardHeader>
        <CardContent>
          {session.data && viewer.data ? (
            <pre
              className="overflow-x-auto rounded-xl border border-border/60 bg-muted/25 p-4 text-xs leading-6 text-foreground"
              data-testid="viewer-output"
            >
              {JSON.stringify(viewer.data, null, 2)}
            </pre>
          ) : (
            <p className="rounded-xl border border-dashed border-border/60 bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
              {viewerMessage ?? "Sign in to fetch the protected viewer procedure."}
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="border-border/60">
        <CardHeader className="space-y-1">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-primary/80">
            Role-gated procedure
          </p>
          <h2 className="text-2xl font-semibold tracking-tight text-foreground">
            Admin control plane
          </h2>
        </CardHeader>
        <CardContent>
          {session.data && adminControlPlane.data ? (
            <pre
              className="overflow-x-auto rounded-xl border border-border/60 bg-muted/25 p-4 text-xs leading-6 text-foreground"
              data-testid="admin-output"
            >
              {JSON.stringify(adminControlPlane.data, null, 2)}
            </pre>
          ) : (
            <p className="rounded-xl border border-dashed border-border/60 bg-muted/15 p-4 text-sm leading-6 text-muted-foreground">
              {adminMessage ?? "Elevated roles can inspect governance guardrails here."}
            </p>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
