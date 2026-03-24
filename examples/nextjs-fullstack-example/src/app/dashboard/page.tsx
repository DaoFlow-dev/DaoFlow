"use client";

import { useEffect, useState } from "react";
import { authClient } from "@/lib/auth-client";

interface Task {
  id: number;
  title: string;
  completed: boolean;
  createdAt: string;
}

export default function Dashboard() {
  const [user, setUser] = useState<{ name: string; email: string } | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTask, setNewTask] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authClient.getSession().then((session) => {
      if (!session.data?.user) {
        window.location.href = "/";
        return;
      }
      setUser({ name: session.data.user.name, email: session.data.user.email });
      loadTasks();
    });
  }, []);

  async function loadTasks() {
    try {
      const res = await fetch("/api/tasks");
      if (res.ok) setTasks(await res.json());
    } catch {
      /* ignore */
    }
    setLoading(false);
  }

  async function addTask(e: React.FormEvent) {
    e.preventDefault();
    if (!newTask.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: newTask.trim() })
    });
    setNewTask("");
    loadTasks();
  }

  async function toggleTask(id: number) {
    await fetch(`/api/tasks/${id}`, { method: "PATCH" });
    loadTasks();
  }

  async function handleSignOut() {
    await authClient.signOut();
    window.location.href = "/";
  }

  if (loading) {
    return (
      <main
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "100vh"
        }}
      >
        <p style={{ color: "#71717a" }}>Loading…</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 600, margin: "0 auto", padding: "2rem 1rem" }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "2rem"
        }}
      >
        <div>
          <h1 style={{ fontSize: "1.5rem", fontWeight: 700, margin: 0 }}>Dashboard</h1>
          <p style={{ color: "#71717a", fontSize: "0.85rem", margin: "0.25rem 0 0" }}>
            Welcome, {user?.name ?? user?.email}
          </p>
        </div>
        <button
          onClick={handleSignOut}
          style={{
            padding: "0.5rem 1rem",
            border: "1px solid #3f3f46",
            borderRadius: 8,
            background: "transparent",
            color: "#a1a1aa",
            cursor: "pointer",
            fontSize: "0.8rem"
          }}
        >
          Sign Out
        </button>
      </div>

      {/* Add task */}
      <form onSubmit={addTask} style={{ display: "flex", gap: 8, marginBottom: "1.5rem" }}>
        <input
          type="text"
          placeholder="Add a task…"
          value={newTask}
          onChange={(e) => setNewTask(e.target.value)}
          style={{
            flex: 1,
            padding: "0.65rem 0.85rem",
            border: "1px solid #3f3f46",
            borderRadius: 8,
            background: "#09090b",
            color: "#e4e4e7",
            fontSize: "0.9rem",
            outline: "none"
          }}
        />
        <button
          type="submit"
          style={{
            padding: "0.65rem 1.25rem",
            border: "none",
            borderRadius: 8,
            background: "#3b82f6",
            color: "#fff",
            fontWeight: 600,
            cursor: "pointer"
          }}
        >
          Add
        </button>
      </form>

      {/* Task list */}
      {tasks.length === 0 ? (
        <p style={{ color: "#52525b", textAlign: "center", padding: "2rem 0" }}>
          No tasks yet. Add one above!
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {tasks.map((task) => (
            <div
              key={task.id}
              onClick={() => toggleTask(task.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "0.75rem 1rem",
                borderRadius: 10,
                background: "#18181b",
                border: "1px solid #27272a",
                cursor: "pointer",
                transition: "border-color 0.2s"
              }}
            >
              <span
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  border: task.completed ? "none" : "2px solid #3f3f46",
                  background: task.completed ? "#22c55e" : "transparent",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "0.7rem",
                  color: "#fff",
                  flexShrink: 0
                }}
              >
                {task.completed ? "✓" : ""}
              </span>
              <span
                style={{
                  textDecoration: task.completed ? "line-through" : "none",
                  color: task.completed ? "#52525b" : "#e4e4e7"
                }}
              >
                {task.title}
              </span>
            </div>
          ))}
        </div>
      )}

      <div
        style={{
          marginTop: "2rem",
          padding: "1rem",
          borderRadius: 10,
          background: "#18181b",
          border: "1px solid #27272a",
          fontSize: "0.8rem",
          color: "#71717a"
        }}
      >
        <strong style={{ color: "#a1a1aa" }}>Stack:</strong> Next.js · Better Auth · Postgres ·
        Inngest
        <br />
        <strong style={{ color: "#a1a1aa" }}>Deploy:</strong>{" "}
        <code style={{ color: "#3b82f6" }}>daoflow deploy --compose ./compose.yaml</code>
      </div>
    </main>
  );
}
