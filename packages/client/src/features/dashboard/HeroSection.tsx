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
  const metrics = [
    {
      label: "Session",
      value: session.isPending ? "checking" : session.data ? "signed in" : "signed out",
      detail: session.data
        ? session.data.user.email
        : "Use Better Auth to unlock protected tRPC data.",
      valueTestId: "session-state",
      detailTestId: session.data ? "session-email" : undefined,
      emphasized: true
    },
    {
      label: "Service health",
      value: health.data?.status ?? "checking",
      emphasized: false
    },
    {
      label: "Current slice",
      value: overview.data?.currentSlice ?? "loading",
      emphasized: false
    },
    {
      label: "Role",
      value: currentRole,
      detail: viewer.data
        ? `${viewer.data.authz.capabilities.length} granted capability lanes`
        : "Role-aware policies unlock after sign-in.",
      valueTestId: "role-state",
      emphasized: false
    }
  ];

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-border/60 bg-gradient-to-br from-card via-card to-muted/40 p-6 shadow-sm sm:p-8">
      <div className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(circle_at_top_left,rgba(99,102,241,0.14),transparent_60%)]" />
      <div className="relative space-y-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-3xl space-y-3">
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-primary/80">
              The agentic platform to host deterministic systems, from one prompt to production
            </p>
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-5xl">
              DaoFlow
            </h1>
          </div>
          <p className="max-w-2xl text-sm leading-6 text-muted-foreground sm:text-base">
            Open-source Agentic DevOps System, from prompts to production.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {metrics.map((metric) => (
            <div
              className={[
                "rounded-2xl border border-border/60 bg-background/80 p-4 shadow-sm backdrop-blur-sm",
                metric.emphasized ? "ring-1 ring-primary/15" : ""
              ]
                .filter(Boolean)
                .join(" ")}
              key={metric.label}
            >
              <span className="text-[0.68rem] font-semibold uppercase tracking-[0.22em] text-muted-foreground">
                {metric.label}
              </span>
              <span
                className="mt-3 block text-xl font-semibold tracking-tight text-foreground"
                data-testid={metric.valueTestId}
              >
                {metric.value}
              </span>
              {metric.detail ? (
                <p
                  className="mt-2 text-sm leading-5 text-muted-foreground"
                  data-testid={metric.detailTestId}
                >
                  {metric.detail}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
