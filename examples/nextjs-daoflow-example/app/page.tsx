export default function Home() {
  return (
    <main
      style={{
        fontFamily: "system-ui, sans-serif",
        maxWidth: 600,
        margin: "80px auto",
        padding: "0 20px"
      }}
    >
      <h1>🚀 Next.js + DaoFlow Example</h1>
      <p>
        This app was deployed using <strong>DaoFlow</strong> — the agentic platform to host
        deterministic systems.
      </p>
      <div
        style={{ background: "#f0f4f8", padding: "20px", borderRadius: "12px", marginTop: "24px" }}
      >
        <h2>Deployment Info</h2>
        <ul style={{ lineHeight: 2 }}>
          <li>
            <strong>Platform:</strong> DaoFlow
          </li>
          <li>
            <strong>Runtime:</strong> Node.js with Docker
          </li>
          <li>
            <strong>Framework:</strong> Next.js 15
          </li>
          <li>
            <strong>Port:</strong> 3001
          </li>
        </ul>
      </div>
      <p style={{ marginTop: "24px", color: "#666" }}>
        Deployed with:{" "}
        <code>daoflow deploy --compose ./docker-compose.yml --server my-server --yes</code>
      </p>
    </main>
  );
}
