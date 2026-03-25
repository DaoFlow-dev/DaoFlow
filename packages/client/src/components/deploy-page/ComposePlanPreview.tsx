import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import type { TemplatePreviewState } from "@/components/templates-page/types";

export function ComposePlanPreview({ previewPlan }: { previewPlan: TemplatePreviewState }) {
  if (previewPlan.isLoading) {
    return (
      <div className="space-y-3" data-testid="compose-preview-loading">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (previewPlan.error) {
    return (
      <Alert variant="destructive" data-testid="compose-preview-error">
        <AlertTitle>Preview failed</AlertTitle>
        <AlertDescription>{previewPlan.error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!previewPlan.data) {
    return null;
  }

  return (
    <section className="space-y-4" data-testid="compose-preview-plan">
      <div>
        <h2 className="text-base font-semibold">Preview Plan</h2>
        <p className="text-sm text-muted-foreground">
          This plan will not be executed until you queue the deployment.
        </p>
      </div>
      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
          <p className="font-medium">Project scope</p>
          <p className="mt-1 text-muted-foreground">
            {previewPlan.data.project.name} · {previewPlan.data.project.action}
          </p>
          <p className="mt-1 text-muted-foreground">
            {previewPlan.data.environment.name} · {previewPlan.data.environment.action}
          </p>
          <p className="mt-1 text-muted-foreground">
            {previewPlan.data.service.name} · {previewPlan.data.service.action}
          </p>
        </div>
        <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
          <p className="font-medium">Target server</p>
          <p className="mt-1 text-muted-foreground">
            {previewPlan.data.target.serverName} · {previewPlan.data.target.serverHost}
          </p>
          <p className="mt-1 text-muted-foreground">
            {previewPlan.data.target.targetKind ?? "unassigned"}
          </p>
        </div>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
        <p className="font-medium">Pre-flight checks</p>
        <ul className="mt-2 space-y-2">
          {previewPlan.data.preflightChecks.map((check) => (
            <li key={`${check.status}-${check.detail}`} className="text-muted-foreground">
              <span className="font-medium uppercase text-foreground">{check.status}</span> ·{" "}
              {check.detail}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
        <p className="font-medium">Execution steps</p>
        <ol className="mt-2 list-decimal space-y-2 pl-5 text-muted-foreground">
          {previewPlan.data.steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>
      <div className="rounded-xl border border-dashed border-border/60 bg-background p-4 text-sm">
        <p className="font-medium">Execution command</p>
        <p className="mt-2 break-all font-mono text-muted-foreground">
          {previewPlan.data.executeCommand}
        </p>
      </div>
    </section>
  );
}
