import type { AppTemplateDefinition } from "@daoflow/shared";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Eye, Rocket } from "lucide-react";
import { TemplateDeployResultAlert } from "./TemplateDeployResultAlert";
import type {
  TemplateDeployResult,
  TemplateFieldValues,
  TemplatePreviewState,
  TemplateServerOption
} from "./types";

interface TemplateConfigurationCardProps {
  activeTemplate: AppTemplateDefinition;
  projectName: string;
  fieldValues: TemplateFieldValues;
  selectedServerId: string;
  servers: TemplateServerOption[];
  inventoryLoading: boolean;
  previewRequested: boolean;
  renderedError: string | null;
  deployError: string | null;
  deployPending: boolean;
  deployResult: TemplateDeployResult | null;
  previewPlan: TemplatePreviewState;
  onProjectNameChange: (value: string) => void;
  onServerChange: (value: string) => void;
  onFieldValueChange: (key: string, value: string) => void;
  onPreviewRequest: () => void;
  onApply: () => void;
  onOpenDeployments: () => void;
  onOpenInstance: () => void;
}

export function TemplateConfigurationCard({
  activeTemplate,
  projectName,
  fieldValues,
  selectedServerId,
  servers,
  inventoryLoading,
  previewRequested,
  renderedError,
  deployError,
  deployPending,
  deployResult,
  previewPlan,
  onProjectNameChange,
  onServerChange,
  onFieldValueChange,
  onPreviewRequest,
  onApply,
  onOpenDeployments,
  onOpenInstance
}: TemplateConfigurationCardProps) {
  return (
    <Card className="border-border/60 shadow-sm">
      <CardHeader>
        <CardTitle data-testid="template-active-name">{activeTemplate.name}</CardTitle>
        <CardDescription>{activeTemplate.description}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="template-project-name">Project name</Label>
            <Input
              id="template-project-name"
              value={projectName}
              onChange={(event) => onProjectNameChange(event.target.value)}
              data-testid="template-project-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="template-server-select">Target server</Label>
            <Select value={selectedServerId} onValueChange={onServerChange}>
              <SelectTrigger id="template-server-select" data-testid="template-server-select">
                <SelectValue
                  placeholder={inventoryLoading ? "Loading servers..." : "Select a server"}
                />
              </SelectTrigger>
              <SelectContent>
                {servers.map((server) => (
                  <SelectItem key={server.id} value={server.id}>
                    {server.name} · {server.host} · {server.targetKind}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        {activeTemplate.fields.map((field) => (
          <div key={field.key} className="space-y-2">
            <Label htmlFor={`template-input-${field.key}`}>{field.label}</Label>
            <Input
              id={`template-input-${field.key}`}
              type={field.kind === "secret" ? "password" : "text"}
              value={fieldValues[field.key] ?? ""}
              onChange={(event) => onFieldValueChange(field.key, event.target.value)}
              placeholder={field.defaultValue ?? field.exampleValue ?? ""}
              data-testid={`template-input-${field.key}`}
            />
            <p className="text-sm text-muted-foreground">{field.description}</p>
          </div>
        ))}

        <div className="grid gap-4 md:grid-cols-2">
          <section className="space-y-2" data-testid="template-services">
            <h2 className="text-sm font-semibold">Services</h2>
            {activeTemplate.services.map((service) => (
              <div
                key={service.name}
                className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
              >
                <p className="font-medium">{service.name}</p>
                <p className="text-muted-foreground">{service.summary}</p>
              </div>
            ))}
          </section>
          <section className="space-y-2" data-testid="template-volumes">
            <h2 className="text-sm font-semibold">Volumes and health</h2>
            {activeTemplate.volumes.map((volume) => (
              <div
                key={volume.nameTemplate}
                className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
              >
                <p className="font-medium">{volume.nameTemplate}</p>
                <p className="text-muted-foreground">
                  {volume.mountPath} · {volume.summary}
                </p>
              </div>
            ))}
            {activeTemplate.healthChecks.map((check) => (
              <div
                key={`${check.serviceName}-${check.summary}`}
                className="rounded-xl border border-border/60 bg-muted/20 p-3 text-sm"
              >
                <p className="font-medium">{check.serviceName}</p>
                <p className="text-muted-foreground">{check.summary}</p>
                <p className="mt-1 text-muted-foreground">{check.readinessHint}</p>
              </div>
            ))}
          </section>
        </div>

        {renderedError ? (
          <Alert variant="destructive" data-testid="template-render-error">
            <AlertTitle>Template input needs attention</AlertTitle>
            <AlertDescription>{renderedError}</AlertDescription>
          </Alert>
        ) : null}

        {deployError ? (
          <Alert variant="destructive" data-testid="template-apply-error">
            <AlertTitle>Deployment failed</AlertTitle>
            <AlertDescription>{deployError}</AlertDescription>
          </Alert>
        ) : null}

        {deployResult ? (
          <TemplateDeployResultAlert
            deployResult={deployResult}
            onOpenDeployments={onOpenDeployments}
            onOpenInstance={onOpenInstance}
          />
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            variant="outline"
            onClick={onPreviewRequest}
            disabled={!selectedServerId || Boolean(renderedError)}
            data-testid="template-preview-button"
          >
            <Eye size={14} className="mr-2" />
            Preview plan
          </Button>
          <Button
            onClick={onApply}
            disabled={!selectedServerId || Boolean(renderedError) || deployPending}
            data-testid="template-apply-button"
          >
            <Rocket size={14} className="mr-2" />
            {deployPending ? "Queueing..." : "Apply template"}
          </Button>
        </div>

        {previewRequested ? <TemplatePreviewSection previewPlan={previewPlan} /> : null}
      </CardContent>
    </Card>
  );
}

function TemplatePreviewSection({ previewPlan }: { previewPlan: TemplatePreviewState }) {
  if (previewPlan.isLoading) {
    return (
      <div className="space-y-3" data-testid="template-preview-loading">
        <Skeleton className="h-6 w-40 rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
        <Skeleton className="h-28 w-full rounded-lg" />
      </div>
    );
  }

  if (previewPlan.error) {
    return (
      <Alert variant="destructive" data-testid="template-preview-error">
        <AlertTitle>Preview failed</AlertTitle>
        <AlertDescription>{previewPlan.error.message}</AlertDescription>
      </Alert>
    );
  }

  if (!previewPlan.data) {
    return null;
  }

  return (
    <section className="space-y-4" data-testid="template-preview-plan">
      <div>
        <h2 className="text-base font-semibold">Rendered Template Plan</h2>
        <p className="text-sm text-muted-foreground">
          This plan will not be executed until you apply the template.
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
        <ul className="mt-2 space-y-2 text-muted-foreground">
          {previewPlan.data.preflightChecks.map((check) => (
            <li key={`${check.status}-${check.detail}`}>
              {check.status} · {check.detail}
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
        <p className="font-medium">Planned steps</p>
        <ol className="mt-2 space-y-2 text-muted-foreground">
          {previewPlan.data.steps.map((step, index) => (
            <li key={step}>
              {index + 1}. {step}
            </li>
          ))}
        </ol>
      </div>
      <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-sm">
        <p className="font-medium">CLI handoff</p>
        <p className="mt-2 break-all font-mono text-xs text-muted-foreground">
          {previewPlan.data.executeCommand}
        </p>
      </div>
    </section>
  );
}
