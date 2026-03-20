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
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background before:pointer-events-none before:absolute before:-left-1/2 before:-top-1/2 before:h-[200%] before:w-[200%] before:bg-[radial-gradient(ellipse_at_30%_50%,_color-mix(in_oklch,var(--primary)_6%,transparent)_0%,transparent_50%),radial-gradient(ellipse_at_70%_30%,_color-mix(in_oklch,#a855f7_4%,transparent)_0%,transparent_50%)]">
      <div className="relative z-10 flex w-full max-w-[420px] flex-col items-center px-6 py-8">
        {/* Logo */}
        <div className="mb-2 flex items-center gap-3 text-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 shadow-sm">
            <Hexagon size={24} strokeWidth={1.5} className="text-primary" />
          </div>
          <h1 className="m-0 text-[1.75rem] font-extrabold tracking-tight">DaoFlow</h1>
        </div>
        <p className="mb-6 max-w-xs text-center text-sm leading-relaxed text-muted-foreground">
          The agentic platform to host deterministic systems — from one prompt to production.
        </p>

        <Card className="w-full overflow-hidden border shadow-lg">
          <div className="h-1 bg-gradient-to-r from-primary via-primary/50 to-violet-500/30" />
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
