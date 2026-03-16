import { useState } from "react";
import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";

type SetupStep = "welcome" | "account" | "server" | "complete";

export default function SetupWizardPage() {
  const session = useSession();
  const [step, setStep] = useState<SetupStep>("welcome");
  const [serverForm, setServerForm] = useState({
    name: "",
    host: "",
    sshPort: "22",
    region: ""
  });
  const [feedback, setFeedback] = useState<string | null>(null);

  const registerServer = trpc.registerServer.useMutation({
    onSuccess: () => {
      setFeedback(null);
      setStep("complete");
    },
    onError: (err) => setFeedback(err.message)
  });

  if (step === "welcome") {
    return (
      <main className="shell" style={{ maxWidth: 600, paddingTop: "4rem" }}>
        <section className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
          <h1
            style={{ fontSize: "1.8rem", fontWeight: 800, color: "#f0f2f5", margin: "0 0 0.75rem" }}
          >
            Welcome to DaoFlow
          </h1>
          <p style={{ color: "#7a8194", fontSize: "0.95rem", margin: "0 0 1.5rem" }}>
            Let{"'"}s set up your deployment control plane in a few quick steps.
          </p>
          {session.data ? (
            <button className="action-button" onClick={() => setStep("server")}>
              Continue to Server Setup →
            </button>
          ) : (
            <button className="action-button" onClick={() => setStep("account")}>
              Create Your Account →
            </button>
          )}
        </section>
      </main>
    );
  }

  if (step === "account") {
    return (
      <main className="shell" style={{ maxWidth: 600, paddingTop: "4rem" }}>
        <section className="auth-panel" style={{ padding: "2rem" }}>
          <h2
            style={{ fontSize: "1.3rem", fontWeight: 700, color: "#f0f2f5", margin: "0 0 0.5rem" }}
          >
            Step 1: Create Owner Account
          </h2>
          <p style={{ color: "#7a8194", fontSize: "0.88rem", margin: "0 0 1rem" }}>
            Sign up using the form above. Your first account will be the platform owner.
          </p>
          <p style={{ color: "#5a6478", fontSize: "0.82rem" }}>
            After signing up, this wizard will guide you through server registration.
          </p>
          {session.data && (
            <button
              className="action-button"
              style={{ marginTop: "1rem" }}
              onClick={() => setStep("server")}
            >
              Continue to Server Setup →
            </button>
          )}
        </section>
      </main>
    );
  }

  if (step === "server") {
    return (
      <main className="shell" style={{ maxWidth: 600, paddingTop: "4rem" }}>
        <section className="auth-panel" style={{ padding: "2rem" }}>
          <h2
            style={{ fontSize: "1.3rem", fontWeight: 700, color: "#f0f2f5", margin: "0 0 0.5rem" }}
          >
            Step 2: Register Your First Server
          </h2>
          <p style={{ color: "#7a8194", fontSize: "0.88rem", margin: "0 0 1.25rem" }}>
            Connect a Docker host that DaoFlow will manage via SSH.
          </p>

          {feedback && (
            <div className="toast toast--error" style={{ marginBottom: "1rem" }}>
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
            style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}
          >
            <div>
              <label
                style={{ fontSize: "0.82rem", color: "#7a8194", display: "block", marginBottom: 4 }}
              >
                Server Name
              </label>
              <input
                type="text"
                value={serverForm.name}
                onChange={(e) => setServerForm({ ...serverForm, name: e.target.value })}
                placeholder="my-vps-1"
                required
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 8,
                  background: "#1a1d24",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e1e4ea",
                  fontSize: "0.88rem"
                }}
              />
            </div>
            <div>
              <label
                style={{ fontSize: "0.82rem", color: "#7a8194", display: "block", marginBottom: 4 }}
              >
                Host (IP or hostname)
              </label>
              <input
                type="text"
                value={serverForm.host}
                onChange={(e) => setServerForm({ ...serverForm, host: e.target.value })}
                placeholder="203.0.113.10"
                required
                style={{
                  width: "100%",
                  padding: "0.5rem 0.75rem",
                  borderRadius: 8,
                  background: "#1a1d24",
                  border: "1px solid rgba(255,255,255,0.08)",
                  color: "#e1e4ea",
                  fontSize: "0.88rem"
                }}
              />
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "0.75rem" }}>
              <div>
                <label
                  style={{
                    fontSize: "0.82rem",
                    color: "#7a8194",
                    display: "block",
                    marginBottom: 4
                  }}
                >
                  SSH Port
                </label>
                <input
                  type="number"
                  value={serverForm.sshPort}
                  onChange={(e) => setServerForm({ ...serverForm, sshPort: e.target.value })}
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    background: "#1a1d24",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e1e4ea",
                    fontSize: "0.88rem"
                  }}
                />
              </div>
              <div>
                <label
                  style={{
                    fontSize: "0.82rem",
                    color: "#7a8194",
                    display: "block",
                    marginBottom: 4
                  }}
                >
                  Region
                </label>
                <input
                  type="text"
                  value={serverForm.region}
                  onChange={(e) => setServerForm({ ...serverForm, region: e.target.value })}
                  placeholder="us-west-2"
                  style={{
                    width: "100%",
                    padding: "0.5rem 0.75rem",
                    borderRadius: 8,
                    background: "#1a1d24",
                    border: "1px solid rgba(255,255,255,0.08)",
                    color: "#e1e4ea",
                    fontSize: "0.88rem"
                  }}
                />
              </div>
            </div>
            <button
              type="submit"
              className="action-button"
              disabled={registerServer.isPending}
              style={{ marginTop: "0.5rem" }}
            >
              {registerServer.isPending ? "Registering..." : "Register Server →"}
            </button>
          </form>
        </section>
      </main>
    );
  }

  // step === "complete"
  return (
    <main className="shell" style={{ maxWidth: 600, paddingTop: "4rem" }}>
      <section className="auth-panel" style={{ textAlign: "center", padding: "2rem" }}>
        <h2
          style={{ fontSize: "1.5rem", fontWeight: 800, color: "#22c55e", margin: "0 0 0.75rem" }}
        >
          ✓ Setup Complete
        </h2>
        <p style={{ color: "#7a8194", fontSize: "0.95rem", margin: "0 0 1.5rem" }}>
          Your DaoFlow control plane is ready. Create your first project and queue a deployment.
        </p>
        <a
          href="/"
          className="action-button"
          style={{ textDecoration: "none", display: "inline-block" }}
        >
          Go to Dashboard
        </a>
      </section>
    </main>
  );
}
