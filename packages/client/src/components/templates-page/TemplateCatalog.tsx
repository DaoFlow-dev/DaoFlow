import type { AppTemplateDefinition } from "@daoflow/shared";
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
          <Badge variant="secondary" data-testid={`template-category-${template.slug}`}>
            {categoryLabel(template.category)}
          </Badge>
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
