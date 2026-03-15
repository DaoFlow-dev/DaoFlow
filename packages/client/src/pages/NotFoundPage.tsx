import { Link } from "react-router-dom";

export default function NotFoundPage() {
  return (
    <main className="shell" style={{ textAlign: "center", paddingTop: "6rem" }}>
      <h1 style={{ fontSize: "4rem", fontWeight: 800, color: "#f0f2f5", margin: 0 }}>404</h1>
      <p style={{ color: "#7a8194", fontSize: "1.1rem", margin: "0.5rem 0 1.5rem" }}>
        This page doesn&apos;t exist.
      </p>
      <Link
        to="/"
        className="action-button"
        style={{ display: "inline-block", textDecoration: "none" }}
      >
        Back to Dashboard
      </Link>
    </main>
  );
}
