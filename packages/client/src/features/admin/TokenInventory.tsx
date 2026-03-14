interface TokenItem {
  id: string;
  label: string;
  principalKind: string;
  principalRole: string;
  principalName: string;
  tokenPrefix: string;
  status: string;
  lanes: string[];
  scopes: string[];
  effectiveCapabilities: string[];
  withheldCapabilities: string[];
}

interface TokenInventoryData {
  summary: {
    totalTokens: number;
    readOnlyTokens: number;
    planningTokens: number;
    commandTokens: number;
  };
  tokens: TokenItem[];
}

export interface TokenInventoryProps {
  session: { data: unknown };
  agentTokenInventory: { data?: TokenInventoryData };
  tokenMessage: string | null;
}

export function TokenInventory({
  session,
  agentTokenInventory,
  tokenMessage
}: TokenInventoryProps) {
  return (
    <section className="token-inventory">
      <div className="roadmap__header">
        <p className="roadmap__kicker">Agent-safe API tokens</p>
        <h2>Scoped automation identities</h2>
      </div>

      {session.data && agentTokenInventory.data ? (
        <>
          <div className="token-summary" data-testid="token-summary">
            <div className="token-summary__item">
              <span className="metric__label">Total tokens</span>
              <strong>{agentTokenInventory.data.summary.totalTokens}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Read-only</span>
              <strong>{agentTokenInventory.data.summary.readOnlyTokens}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Planning</span>
              <strong>{agentTokenInventory.data.summary.planningTokens}</strong>
            </div>
            <div className="token-summary__item">
              <span className="metric__label">Command</span>
              <strong>{agentTokenInventory.data.summary.commandTokens}</strong>
            </div>
          </div>

          <div className="token-list">
            {agentTokenInventory.data.tokens.map((token) => (
              <article className="token-card" data-testid={`token-card-${token.id}`} key={token.id}>
                <div className="token-card__top">
                  <div>
                    <p className="roadmap-item__lane">
                      {token.principalKind} · {token.principalRole}
                    </p>
                    <h3>{token.label}</h3>
                  </div>
                  <span
                    className={`deployment-status deployment-status--${token.status === "active" ? "healthy" : token.status === "paused" ? "running" : "failed"}`}
                  >
                    {token.status}
                  </span>
                </div>
                <p className="deployment-card__meta">
                  {token.principalName} · Prefix {token.tokenPrefix}
                </p>
                <p className="deployment-card__meta">
                  Lanes: {token.lanes.join(", ")} · Effective capabilities:{" "}
                  {token.effectiveCapabilities.length}
                </p>
                <div className="token-card__chips">
                  {token.scopes.map((scope) => (
                    <span className="token-chip" key={scope}>
                      {scope}
                    </span>
                  ))}
                </div>
                <p className="deployment-card__meta">
                  Withheld from role by token narrowing: {token.withheldCapabilities.length}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : (
        <p className="viewer-empty">
          {tokenMessage ?? "Elevated roles can inspect scoped automation identities here."}
        </p>
      )}
    </section>
  );
}
