import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Hammer } from "lucide-react";

interface BuildResolvedValueRecord {
  key: string;
  displayValue: string;
  isSecret: boolean;
  source: "inline" | "1password";
  scopeLabel: string;
  branchPattern: string | null;
  originSummary: string;
}

interface BuildLayerRecord {
  isSecret: boolean;
  branchPattern: string | null;
}

interface BuildValuePanelProps {
  serviceId: string;
  vars: BuildLayerRecord[];
  resolvedVars: BuildResolvedValueRecord[];
}

export default function BuildValuePanel({ serviceId, vars, resolvedVars }: BuildValuePanelProps) {
  const buildSecrets = vars.filter((variable) => variable.isSecret);
  const buildPreviewOverrides = vars.filter((variable) => variable.branchPattern !== null);

  return (
    <Card data-testid={`service-build-panel-${serviceId}`}>
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Hammer size={14} />
          Build-time values
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-1">
          <p className="text-sm text-muted-foreground">
            Build values follow the same layering model as runtime values: shared environment
            defaults first, then service overrides, then preview-only overrides when the branch
            pattern matches.
          </p>
          <p className="text-sm text-muted-foreground">
            Use the override form above and choose the <span className="font-medium">build</span>{" "}
            category when you need Docker build arguments or build-only secret inputs.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          <div
            className="rounded-xl border p-4"
            data-testid={`service-build-summary-layers-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Layers</p>
            <p className="mt-1 text-2xl font-semibold">{vars.length}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-build-summary-resolved-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Resolved</p>
            <p className="mt-1 text-2xl font-semibold">{resolvedVars.length}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-build-summary-secrets-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">Secrets</p>
            <p className="mt-1 text-2xl font-semibold">{buildSecrets.length}</p>
          </div>
          <div
            className="rounded-xl border p-4"
            data-testid={`service-build-summary-preview-${serviceId}`}
          >
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Preview overrides
            </p>
            <p className="mt-1 text-2xl font-semibold">{buildPreviewOverrides.length}</p>
          </div>
        </div>

        {resolvedVars.length === 0 ? (
          <p
            className="rounded-xl border border-dashed px-4 py-6 text-sm text-muted-foreground"
            data-testid={`service-build-empty-${serviceId}`}
          >
            No build-time values are stored for this service yet.
          </p>
        ) : (
          <div className="space-y-3">
            {resolvedVars.map((variable) => (
              <div
                key={`${variable.key}-${variable.branchPattern ?? "base"}`}
                className="rounded-xl border p-3"
                data-testid={`service-build-resolved-${serviceId}-${variable.key}`}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-medium">{variable.key}</span>
                    <Badge variant="outline">{variable.scopeLabel}</Badge>
                    {variable.isSecret ? <Badge variant="outline">Secret</Badge> : null}
                    {variable.source === "1password" ? (
                      <Badge variant="outline">1Password</Badge>
                    ) : null}
                    {variable.branchPattern ? (
                      <Badge variant="outline">{variable.branchPattern}</Badge>
                    ) : null}
                  </div>
                </div>
                <p
                  className="mt-2 font-mono text-sm text-muted-foreground"
                  data-testid={`service-build-resolved-value-${serviceId}-${variable.key}`}
                >
                  {variable.isSecret ? "[secret]" : variable.displayValue}
                </p>
                <p className="mt-2 text-xs text-muted-foreground">{variable.originSummary}</p>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
