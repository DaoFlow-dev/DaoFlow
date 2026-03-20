import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { getBadgeVariantFromTone } from "@/lib/tone-utils";

interface TokenItem {
  id: string;
  label: string;
  principalKind: string;
  principalRole: string;
  principalName: string;
  tokenPrefix: string;
  status: string;
  statusTone: string;
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
    <section className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Agent-safe API tokens
        </p>
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">
          Scoped automation identities
        </h2>
      </div>

      {session.data && agentTokenInventory.data ? (
        <>
          <div className="grid grid-cols-4 gap-3 mb-3" data-testid="token-summary">
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Total tokens
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {agentTokenInventory.data.summary.totalTokens}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Read-only
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {agentTokenInventory.data.summary.readOnlyTokens}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Planning
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {agentTokenInventory.data.summary.planningTokens}
              </strong>
            </Card>
            <Card className="p-4">
              <span className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Command
              </span>
              <strong className="mt-1 block text-2xl font-bold">
                {agentTokenInventory.data.summary.commandTokens}
              </strong>
            </Card>
          </div>

          <div className="space-y-3">
            {agentTokenInventory.data.tokens.map((token) => (
              <Card className="p-5" data-testid={`token-card-${token.id}`} key={token.id}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                      {token.principalKind} · {token.principalRole}
                    </p>
                    <h3 className="text-base font-semibold text-foreground">{token.label}</h3>
                  </div>
                  <Badge variant={getBadgeVariantFromTone(token.statusTone)}>{token.status}</Badge>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  {token.principalName} · Prefix {token.tokenPrefix}
                </p>
                <p className="mt-2 text-sm text-muted-foreground">
                  Lanes: {token.lanes.join(", ")} · Effective capabilities:{" "}
                  {token.effectiveCapabilities.length}
                </p>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {token.scopes.map((scope) => (
                    <Badge variant="secondary" key={scope}>
                      {scope}
                    </Badge>
                  ))}
                </div>
                <p className="mt-2 text-sm text-muted-foreground">
                  Withheld from role by token narrowing: {token.withheldCapabilities.length}
                </p>
              </Card>
            ))}
          </div>
        </>
      ) : (
        <p className="py-10 text-center text-sm text-muted-foreground">
          {tokenMessage ?? "Elevated roles can inspect scoped automation identities here."}
        </p>
      )}
    </section>
  );
}
