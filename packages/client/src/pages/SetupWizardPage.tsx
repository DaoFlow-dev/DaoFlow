import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CheckCircle, Rocket, Server } from "lucide-react";

type SetupStep = "welcome" | "account" | "server" | "complete";

export default function SetupWizardPage() {
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const requestedStep = searchParams.get("step");
  const initialStep: SetupStep =
    requestedStep === "account" ||
    requestedStep === "server" ||
    requestedStep === "complete" ||
    requestedStep === "welcome"
      ? requestedStep
      : "welcome";
  const [step, setStep] = useState<SetupStep>(initialStep);
  const [serverForm, setServerForm] = useState({
    name: "",
    host: "",
    sshPort: "22",
    region: ""
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  function updateStep(nextStep: SetupStep) {
    setStep(nextStep);
    const next = new URLSearchParams(searchParams);
    if (nextStep === "welcome") {
      next.delete("step");
    } else {
      next.set("step", nextStep);
    }
    setSearchParams(next, { replace: true });
  }

  const registerServer = trpc.registerServer.useMutation({
    onSuccess: () => {
      setFeedback(null);
      updateStep("complete");
    },
    onError: (err) => setFeedback(err.message)
  });

  useEffect(() => {
    if (!session.isPending && !session.data && (step === "server" || step === "complete")) {
      setStep("account");
      const next = new URLSearchParams(searchParams);
      next.set("step", "account");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, session.isPending, session.data, setSearchParams, step]);

  if (step === "welcome") {
    return (
      <main className="shell flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Card className="w-full max-w-lg text-center">
          <CardHeader className="space-y-2 pb-4">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Rocket size={24} className="text-primary" />
            </div>
            <CardTitle className="text-2xl">Welcome to DaoFlow</CardTitle>
            <CardDescription>
              Let&apos;s set up your hosting platform in a few quick steps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {session.data ? (
              <Button size="lg" onClick={() => updateStep("server")}>
                Continue to Server Setup →
              </Button>
            ) : (
              <Button size="lg" onClick={() => updateStep("account")}>
                Create Your Account →
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  if (step === "account") {
    return (
      <main className="shell flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Badge variant="outline" className="w-fit">
              Step 1 of 2
            </Badge>
            <CardTitle>Create Owner Account</CardTitle>
            <CardDescription>
              Create or sign in to your owner account before registering the first server.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              Your first authenticated account becomes the platform owner. After login you will
              return directly to server setup.
            </p>
            <Link to="/login?returnTo=%2Fsetup%3Fstep%3Dserver" className="inline-block">
              <Button>Go to Sign In / Sign Up →</Button>
            </Link>
            {session.data && (
              <Button onClick={() => updateStep("server")}>Continue to Server Setup →</Button>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  if (step === "server") {
    return (
      <main className="shell flex items-center justify-center" style={{ minHeight: "60vh" }}>
        <Card className="w-full max-w-lg">
          <CardHeader>
            <Badge variant="outline" className="w-fit">
              Step 2 of 2
            </Badge>
            <CardTitle className="flex items-center gap-2">
              <Server size={20} /> Register Your First Server
            </CardTitle>
            <CardDescription>
              Connect a Docker host that DaoFlow will manage via SSH.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {feedback && (
              <div className="mb-4 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {feedback}
              </div>
            )}

            <form
              onSubmit={(e) => {
                e.preventDefault();
                registerServer.mutate({
                  name: serverForm.name,
                  host: serverForm.host,
                  sshPort: parseInt(serverForm.sshPort) || 22,
                  region: serverForm.region || "default",
                  kind: "docker-engine"
                });
              }}
              className="space-y-4"
            >
              <div className="space-y-2">
                <Label htmlFor="server-name">Server Name</Label>
                <Input
                  id="server-name"
                  value={serverForm.name}
                  onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
                  placeholder="my-vps-1"
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="server-host">Host (IP or hostname)</Label>
                <Input
                  id="server-host"
                  value={serverForm.host}
                  onChange={(e) => setServerForm({ ...serverForm, host: e.target.value })}
                  placeholder="203.0.113.10"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="ssh-port">SSH Port</Label>
                  <Input
                    id="ssh-port"
                    type="number"
                    value={serverForm.sshPort}
                    onChange={(e) => setServerForm({ ...serverForm, sshPort: e.target.value })}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="region">Region</Label>
                  <Input
                    id="region"
                    value={serverForm.region}
                    onChange={(e) => setServerForm({ ...serverForm, region: e.target.value })}
                    placeholder="us-west-2"
                  />
                </div>
              </div>

              <Button type="submit" className="w-full" disabled={registerServer.isPending}>
                {registerServer.isPending ? "Registering..." : "Register Server →"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </main>
    );
  }

  // step === "complete"
  return (
    <main className="shell flex items-center justify-center" style={{ minHeight: "60vh" }}>
      <Card className="w-full max-w-lg text-center">
        <CardHeader className="space-y-2 pb-4">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-green-500/10">
            <CheckCircle size={24} className="text-green-500" />
          </div>
          <CardTitle className="text-2xl text-green-500">Setup Complete</CardTitle>
          <CardDescription>
            Your DaoFlow control plane is ready. Create your first project and queue a deployment.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Link to="/" className="inline-block">
            <Button size="lg">Go to Dashboard</Button>
          </Link>
        </CardContent>
      </Card>
    </main>
  );
}
