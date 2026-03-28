import {
  describeAppTemplateFreshness,
  resolveAppTemplateFreshness,
  type AppTemplateDefinition
} from "@daoflow/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { LayoutTemplate } from "lucide-react";
import type { TemplateCatalogCardProps } from "./types";
import { categoryLabel } from "./utils";

export function TemplateCatalog({
  matchingTemplates,
  activeSlug,
  onSelectTemplate
}: TemplateCatalogCardProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2" data-testid="templates-catalog">
      {matchingTemplates.map((template) => (
        <TemplateCatalogCard
          key={template.slug}
          template={template}
          isActive={template.slug === activeSlug}
          onSelectTemplate={onSelectTemplate}
        />
      ))}
    </div>
  );
}

function TemplateCatalogCard({
  template,
  isActive,
  onSelectTemplate
}: {
  template: AppTemplateDefinition;
  isActive: boolean;
  onSelectTemplate: (slug: string) => void;
}) {
  const freshness = resolveAppTemplateFreshness(template);
  const latestReviewNote = template.maintenance.changeNotes[0] ?? "No review notes recorded yet.";
  const freshnessVariant =
    freshness.status === "stale"
      ? "destructive"
      : freshness.status === "review-soon"
        ? "secondary"
        : "success";

  return (
    <Card
      className={isActive ? "border-primary/50 shadow-md" : "border-border/60"}
      data-testid={`template-card-${template.slug}`}
    >
      <CardHeader className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div>
            <CardTitle className="text-base">{template.name}</CardTitle>
            <CardDescription>{template.summary}</CardDescription>
          </div>
          <div className="flex flex-col items-end gap-2">
            <Badge variant="secondary" data-testid={`template-category-${template.slug}`}>
              {categoryLabel(template.category)}
            </Badge>
            <Badge variant={freshnessVariant} data-testid={`template-freshness-${template.slug}`}>
              {describeAppTemplateFreshness(freshness.status)}
            </Badge>
          </div>
        </div>
        <div
          className="rounded-lg border border-border/60 bg-muted/20 px-3 py-2 text-xs text-muted-foreground"
          data-testid={`template-maintenance-${template.slug}`}
        >
          <p>
            {template.maintenance.sourceName} · {template.maintenance.version}
          </p>
          <p>
            Reviewed {new Date(freshness.reviewedAt).toLocaleDateString()} · due{" "}
            {new Date(freshness.reviewDueAt).toLocaleDateString()}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {template.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">{template.description}</p>
        <div className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
          Latest review note: {latestReviewNote}
        </div>
        <Button
          variant={isActive ? "default" : "outline"}
          className="w-full"
          onClick={() => onSelectTemplate(template.slug)}
          data-testid={`template-select-${template.slug}`}
        >
          <LayoutTemplate size={14} className="mr-2" />
          {isActive ? "Selected" : "Configure template"}
        </Button>
      </CardContent>
    </Card>
  );
}
