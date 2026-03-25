import { useSearchParams } from "react-router-dom";
import { Boxes, Code2, LayoutTemplate, RefreshCw } from "lucide-react";
import { RawComposeDeployPanel } from "@/components/deploy-page/RawComposeDeployPanel";
import { ServiceRolloutPanel } from "@/components/deploy-page/ServiceRolloutPanel";
import { TemplateDeployPanel } from "@/components/deploy-page/TemplateDeployPanel";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

type DeploySource = "template" | "compose" | "service";

const sourceCards: Array<{
  source: DeploySource;
  label: string;
  title: string;
  description: string;
  icon: typeof LayoutTemplate;
}> = [
  {
    source: "template",
    label: "Template",
    title: "Curated template",
    description: "Start from a known stack and land it quickly in a real project target.",
    icon: LayoutTemplate
  },
  {
    source: "compose",
    label: "Raw Compose",
    title: "Paste Compose",
    description: "Bring your own Compose file, preview the plan, and queue it directly.",
    icon: Code2
  },
  {
    source: "service",
    label: "Service rollout",
    title: "Redeploy a service",
    description: "Preview and queue a rollout for an existing registered service.",
    icon: RefreshCw
  }
];

function readSource(searchParams: URLSearchParams): DeploySource {
  const requested = searchParams.get("source");
  if (requested === "compose" || requested === "service" || requested === "template") {
    return requested;
  }

  return "template";
}

export default function DeployPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSource = readSource(searchParams);

  function selectSource(source: DeploySource) {
    const next = new URLSearchParams(searchParams);
    next.set("source", source);
    setSearchParams(next, { replace: true });
  }

  return (
    <main className="shell space-y-6" data-testid="deploy-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Deploy</h1>
          <p className="text-sm text-muted-foreground">
            Choose the source of truth first, preview the exact plan, then queue the deployment from
            one place.
          </p>
        </div>
        <div className="rounded-full border border-border/60 bg-muted/20 px-3 py-1 text-xs text-muted-foreground">
          Preview-first flow
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3" data-testid="deploy-source-selector">
        {sourceCards.map((card) => {
          const selected = activeSource === card.source;
          return (
            <Card
              key={card.source}
              className={selected ? "border-primary/50 shadow-md" : "border-border/60 shadow-sm"}
            >
              <CardHeader>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-2">
                    <card.icon
                      size={16}
                      className={selected ? "text-primary" : "text-foreground"}
                    />
                    <CardTitle className="text-base">{card.title}</CardTitle>
                  </div>
                  <div className="rounded-full border border-border/60 px-2 py-0.5 text-xs text-muted-foreground">
                    {card.label}
                  </div>
                </div>
                <CardDescription>{card.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <Button
                  variant={selected ? "default" : "outline"}
                  className="w-full"
                  onClick={() => selectSource(card.source)}
                  data-testid={`deploy-source-${card.source}`}
                >
                  {selected ? "Selected" : `Use ${card.label}`}
                </Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="border-border/60 bg-muted/10 shadow-sm">
        <CardContent className="flex items-center gap-3 p-4 text-sm text-muted-foreground">
          <Boxes size={16} className="text-primary" />
          Template and raw Compose modes queue direct Compose deployments. Service rollout mode
          previews and queues deployments for services DaoFlow already manages.
        </CardContent>
      </Card>

      {activeSource === "template" ? <TemplateDeployPanel /> : null}
      {activeSource === "compose" ? <RawComposeDeployPanel /> : null}
      {activeSource === "service" ? <ServiceRolloutPanel /> : null}
    </main>
  );
}
