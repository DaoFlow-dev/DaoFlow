interface SessionData {
  user: { email: string };
}

export interface HeroSectionProps {
  session: { isPending: boolean; data: SessionData | null };
  health: { data?: { status: string } };
  overview: { data?: { currentSlice: string } };
  currentRole: string;
  viewer: { data?: { authz: { capabilities: readonly string[] } } | null };
}

export function HeroSection({ session, health, overview, currentRole, viewer }: HeroSectionProps) {
  return (
    <section className="hero">
      <div className="hero__copy">
        <p className="hero__kicker">Docker-first control plane</p>
        <h1>DaoFlow</h1>
        <p className="hero__lede">
          A typed control plane for Docker and Compose deployments with agent-safe automation
          boundaries.
        </p>
      </div>

      <div className="hero__rail">
        <div className="metric metric--auth">
          <span className="metric__label">Session</span>
          <span className="metric__value" data-testid="session-state">
            {session.isPending ? "checking" : session.data ? "signed in" : "signed out"}
          </span>
          {session.data ? (
            <p className="metric__detail" data-testid="session-email">
              {session.data.user.email}
            </p>
          ) : (
            <p className="metric__detail">Use Better Auth to unlock protected tRPC data.</p>
          )}
        </div>
        <div className="metric">
          <span className="metric__label">Service health</span>
          <span className="metric__value">{health.data?.status ?? "checking"}</span>
        </div>
        <div className="metric">
          <span className="metric__label">Current slice</span>
          <span className="metric__value">{overview.data?.currentSlice ?? "loading"}</span>
        </div>
        <div className="metric">
          <span className="metric__label">Role</span>
          <span className="metric__value" data-testid="role-state">
            {currentRole}
          </span>
          <p className="metric__detail">
            {viewer.data
              ? `${viewer.data.authz.capabilities.length} granted capability lanes`
              : "Role-aware policies unlock after sign-in."}
          </p>
        </div>
      </div>
    </section>
  );
}
