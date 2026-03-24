import { useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Hexagon } from "lucide-react";
import { LoginFormTabs } from "@/components/auth/LoginFormTabs";

export default function LoginPage() {
  const session = useSession();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

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

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background before:pointer-events-none before:absolute before:-left-1/2 before:-top-1/2 before:h-[200%] before:w-[200%] before:bg-[radial-gradient(ellipse_at_30%_50%,_color-mix(in_oklch,var(--primary)_6%,transparent)_0%,transparent_50%),radial-gradient(ellipse_at_70%_30%,_color-mix(in_oklch,#a855f7_4%,transparent)_0%,transparent_50%)] after:pointer-events-none after:absolute after:inset-0 after:bg-[radial-gradient(circle_1px_at_16px_16px,_color-mix(in_oklch,var(--foreground)_6%,transparent)_1px,transparent_0)] after:[background-size:32px_32px] after:opacity-40">
      <div
        className="relative z-10 flex w-full max-w-[460px] flex-col items-center px-6 py-8 lg:max-w-[560px]"
        data-testid="login-auth-shell"
      >
        {/* Logo */}
        <div className="mb-2 flex items-center gap-3 text-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 shadow-sm">
            <Hexagon size={24} strokeWidth={1.5} className="text-primary" />
          </div>
          <h1 className="m-0 font-mono text-[1.75rem] font-extrabold tracking-tight">DaoFlow</h1>
        </div>
        <p className="mb-6 max-w-sm text-center text-sm leading-relaxed text-muted-foreground lg:max-w-md">
          The agentic platform to host deterministic systems — from one prompt to production.
        </p>

        <Card
          className="w-full overflow-hidden border shadow-lg lg:shadow-xl"
          data-testid="login-auth-card"
        >
          <div className="h-1 animate-[shimmer_3s_ease-in-out_infinite] bg-[length:200%_100%] bg-gradient-to-r from-primary via-accent-warm to-primary" />
          <CardHeader className="text-center pb-2">
            <h2 className="text-xl font-bold leading-none tracking-tight">Welcome back</h2>
            <CardDescription className="mt-1.5">
              Sign in to your account or create a new one
            </CardDescription>
          </CardHeader>
          <CardContent>
            <LoginFormTabs onAuthenticated={() => session.refetch()} />
          </CardContent>
        </Card>

        <p className="mt-8 text-center text-xs text-muted-foreground">
          Open-source Agentic DevOps — from prompts to production.
        </p>
      </div>
    </div>
  );
}
