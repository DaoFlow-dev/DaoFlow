import { TemplateDeployPanel } from "@/components/deploy-page/TemplateDeployPanel";

export default function TemplatesPage() {
  return (
    <main className="shell space-y-6" data-testid="templates-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Templates</h1>
        <p className="text-sm text-muted-foreground">
          Start from curated Compose stacks, preview the plan, then queue the deployment into the
          target you want to operate.
        </p>
      </div>

      <TemplateDeployPanel />
    </main>
  );
}
