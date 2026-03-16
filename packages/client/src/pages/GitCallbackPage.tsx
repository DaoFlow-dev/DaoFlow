/**
 * GitCallbackPage.tsx — Handles OAuth callbacks from GitHub App installations
 * and GitLab OAuth flows. Parses the callback query params and creates the
 * corresponding git installation record.
 *
 * Routes:
 *   /settings/git/callback?installation_id=...&setup_action=install&provider_id=...
 *   /settings/git/callback?code=...&state=<providerId>  (GitLab OAuth)
 */

import { useEffect, useState } from "react";
import { useSearchParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, XCircle, Loader2, GitBranch } from "lucide-react";

type CallbackState = "processing" | "success" | "error";

export default function GitCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [state, setState] = useState<CallbackState>("processing");
  const [message, setMessage] = useState("Processing callback…");
  const [detail, setDetail] = useState("");

  const createInstallation = trpc.createGitInstallation.useMutation({
    onSuccess: (data: { accountName: string }) => {
      setState("success");
      setMessage("Installation connected successfully");
      setDetail(`Account: ${data.accountName}`);
    },
    onError: (err: { message: string }) => {
      setState("error");
      setMessage("Failed to connect installation");
      setDetail(err.message);
    }
  });

  const exchangeGitLabCode = trpc.exchangeGitLabCode.useMutation({
    onSuccess: (data: { installation: { accountName: string } }) => {
      setState("success");
      setMessage("GitLab connected successfully");
      setDetail(`Account: ${data.installation.accountName}`);
    },
    onError: (err: { message: string }) => {
      setState("error");
      setMessage("Failed to connect GitLab");
      setDetail(err.message);
    }
  });

  useEffect(() => {
    const installationId = searchParams.get("installation_id");
    const setupAction = searchParams.get("setup_action");
    const providerId = searchParams.get("provider_id") || searchParams.get("state");
    const code = searchParams.get("code");

    // GitHub App callback
    if (installationId && providerId) {
      if (setupAction === "install" || setupAction === "update") {
        createInstallation.mutate({
          providerId,
          installationId,
          accountName: searchParams.get("account") || "Unknown",
          accountType: searchParams.get("target_type") || "organization"
        });
      } else {
        setState("error");
        setMessage("Installation was cancelled");
        setDetail("The GitHub App installation was not completed.");
      }
      return;
    }

    // GitLab OAuth callback
    if (code && providerId) {
      exchangeGitLabCode.mutate({
        code,
        providerId
      });
      return;
    }

    setState("error");
    setMessage("Invalid callback");
    setDetail("Missing required parameters. Please try the installation again from Settings.");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <main className="shell flex items-center justify-center" style={{ minHeight: "60vh" }}>
      <Card className="w-full max-w-md text-center">
        <CardHeader className="space-y-2 pb-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
            {state === "processing" && <Loader2 size={24} className="text-primary animate-spin" />}
            {state === "success" && <CheckCircle size={24} className="text-green-500" />}
            {state === "error" && <XCircle size={24} className="text-destructive" />}
          </div>
          <CardTitle className="text-xl flex items-center justify-center gap-2">
            <GitBranch size={18} />
            Git Provider Setup
          </CardTitle>
          <CardDescription>{message}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {detail && (
            <Badge variant={state === "error" ? "destructive" : "secondary"} className="text-sm">
              {detail}
            </Badge>
          )}

          {state !== "processing" && (
            <div className="flex justify-center gap-2">
              <Button onClick={() => void navigate("/settings")} variant="outline">
                Back to Settings
              </Button>
              {state === "success" && (
                <Button onClick={() => void navigate("/projects")}>Go to Projects</Button>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
