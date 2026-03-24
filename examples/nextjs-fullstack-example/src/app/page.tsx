"use client";

import { useState } from "react";
import { authClient } from "@/lib/auth-client";

export default function Home() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      if (mode === "signup") {
        const result = await authClient.signUp.email({
          email,
          password,
          name: name || email.split("@")[0]
        });
        if (result.error) {
          setMessage(`Error: ${result.error.message}`);
        } else {
          setMessage("Account created! Redirecting…");
          window.location.href = "/dashboard";
        }
      } else {
        const result = await authClient.signIn.email({ email, password });
        if (result.error) {
          setMessage(`Error: ${result.error.message}`);
        } else {
          window.location.href = "/dashboard";
        }
      }
    } catch (err) {
      setMessage(`Unexpected error: ${err}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <main
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "100vh"
      }}
    >
      <div
        style={{
          width: 380,
          padding: "2.5rem",
          borderRadius: 16,
          background: "#18181b",
          border: "1px solid #27272a",
          boxShadow: "0 20px 60px rgba(0,0,0,0.5)"
        }}
      >
        <h1
          style={{
            fontSize: "1.5rem",
            fontWeight: 700,
            margin: "0 0 0.25rem",
            textAlign: "center"
          }}
        >
          🚀 Fullstack Demo
        </h1>
        <p
          style={{
            color: "#71717a",
            fontSize: "0.85rem",
            textAlign: "center",
            margin: "0 0 1.5rem"
          }}
        >
          Next.js + Better Auth + Postgres + Inngest
        </p>

        <div style={{ display: "flex", gap: 8, marginBottom: "1.25rem" }}>
          {(["signin", "signup"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setMode(m)}
              style={{
                flex: 1,
                padding: "0.5rem",
                border: "none",
                borderRadius: 8,
                cursor: "pointer",
                fontWeight: 600,
                fontSize: "0.85rem",
                background: mode === m ? "#3b82f6" : "#27272a",
                color: mode === m ? "#fff" : "#a1a1aa",
                transition: "all 0.2s"
              }}
            >
              {m === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" && (
            <input
              type="text"
              placeholder="Name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            type="email"
            placeholder="Email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={inputStyle}
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            style={inputStyle}
          />
          <button
            type="submit"
            disabled={loading}
            style={{
              padding: "0.75rem",
              border: "none",
              borderRadius: 8,
              background: loading ? "#1d4ed8" : "#3b82f6",
              color: "#fff",
              fontWeight: 600,
              fontSize: "0.9rem",
              cursor: loading ? "wait" : "pointer",
              transition: "background 0.2s"
            }}
          >
            {loading ? "…" : mode === "signin" ? "Sign In" : "Create Account"}
          </button>
        </form>

        {message && (
          <p
            style={{
              marginTop: "1rem",
              fontSize: "0.8rem",
              textAlign: "center",
              color: message.startsWith("Error") ? "#ef4444" : "#22c55e"
            }}
          >
            {message}
          </p>
        )}

        <p
          style={{
            color: "#52525b",
            fontSize: "0.75rem",
            textAlign: "center",
            marginTop: "1.5rem"
          }}
        >
          Deployed with <strong>DaoFlow</strong> via Docker Compose
        </p>
      </div>
    </main>
  );
}

const inputStyle: React.CSSProperties = {
  padding: "0.65rem 0.85rem",
  border: "1px solid #3f3f46",
  borderRadius: 8,
  background: "#09090b",
  color: "#e4e4e7",
  fontSize: "0.9rem",
  outline: "none"
};
