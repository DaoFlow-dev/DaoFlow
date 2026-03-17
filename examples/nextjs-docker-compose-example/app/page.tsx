export default function Home() {
  return (
    <main style={{ padding: '2rem', fontFamily: 'system-ui' }}>
      <h1>🚀 Deployed with DaoFlow</h1>
      <p>This Next.js app was deployed using Docker Compose with local build context.</p>
      <code>daoflow deploy --compose ./compose.yaml --server my-server --yes</code>
    </main>
  );
}
