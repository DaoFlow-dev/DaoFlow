import type { AppTemplateDefinition } from "./app-template-types";

const DAY_MS = 24 * 60 * 60 * 1_000;
const REVIEW_SOON_THRESHOLD = 0.75;

export type AppTemplateFreshnessStatus = "current" | "review-soon" | "stale";

export interface AppTemplateFreshnessState {
  status: AppTemplateFreshnessStatus;
  reviewedAt: string;
  reviewDueAt: string;
  daysSinceReview: number;
  daysUntilReview: number;
}

export interface AppTemplateCatalogIssue {
  templateSlug: string;
  severity: "error" | "warning";
  field: string;
  message: string;
}

function readReviewedAt(template: AppTemplateDefinition): Date {
  const reviewedAt = new Date(template.maintenance.reviewedAt);
  if (Number.isNaN(reviewedAt.getTime())) {
    throw new Error(`Template "${template.slug}" has an invalid reviewedAt date.`);
  }

  return reviewedAt;
}

export function describeAppTemplateFreshness(status: AppTemplateFreshnessStatus): string {
  switch (status) {
    case "current":
      return "Current";
    case "review-soon":
      return "Review soon";
    case "stale":
      return "Needs review";
  }
}

export function resolveAppTemplateFreshness(
  template: AppTemplateDefinition,
  now = new Date()
): AppTemplateFreshnessState {
  const reviewedAt = readReviewedAt(template);
  const reviewDueAt = new Date(
    reviewedAt.getTime() + template.maintenance.reviewCadenceDays * DAY_MS
  );
  const elapsedMs = now.getTime() - reviewedAt.getTime();
  const reviewWindowMs = Math.max(DAY_MS, reviewDueAt.getTime() - reviewedAt.getTime());
  const reviewRatio = elapsedMs / reviewWindowMs;
  const status: AppTemplateFreshnessStatus =
    reviewRatio >= 1 ? "stale" : reviewRatio >= REVIEW_SOON_THRESHOLD ? "review-soon" : "current";

  return {
    status,
    reviewedAt: reviewedAt.toISOString(),
    reviewDueAt: reviewDueAt.toISOString(),
    daysSinceReview: Math.max(0, Math.floor(elapsedMs / DAY_MS)),
    daysUntilReview: Math.ceil((reviewDueAt.getTime() - now.getTime()) / DAY_MS)
  };
}

export function inspectAppTemplates(
  templates: readonly AppTemplateDefinition[],
  now = new Date()
): AppTemplateCatalogIssue[] {
  const issues: AppTemplateCatalogIssue[] = [];
  const seenSlugs = new Set<string>();

  for (const template of templates) {
    const push = (
      severity: AppTemplateCatalogIssue["severity"],
      field: string,
      message: string
    ) => {
      issues.push({
        templateSlug: template.slug,
        severity,
        field,
        message
      });
    };

    if (!template.slug.trim()) {
      push("error", "slug", "Template slug is required.");
    } else if (seenSlugs.has(template.slug)) {
      push("error", "slug", "Template slug must be unique.");
    } else {
      seenSlugs.add(template.slug);
    }

    if (!template.name.trim()) {
      push("error", "name", "Template name is required.");
    }
    if (!template.summary.trim()) {
      push("error", "summary", "Template summary is required.");
    }
    if (!template.defaultProjectName.trim()) {
      push("error", "defaultProjectName", "Default project name is required.");
    }
    if (!template.composeTemplate.trim()) {
      push("error", "composeTemplate", "Compose template content is required.");
    }
    if (template.tags.length === 0) {
      push("error", "tags", "At least one tag is required.");
    }
    if (template.services.length === 0) {
      push("error", "services", "At least one service summary is required.");
    }

    const fieldKeys = new Set<string>();
    for (const field of template.fields) {
      if (!field.key.trim()) {
        push("error", "fields", "Template field keys must be non-empty.");
      } else if (fieldKeys.has(field.key)) {
        push("error", "fields", `Template field "${field.key}" must be unique.`);
      } else {
        fieldKeys.add(field.key);
      }
    }

    const maintenance = template.maintenance;
    if (!maintenance.version.trim()) {
      push("error", "maintenance.version", "Template version is required.");
    }
    if (!maintenance.sourceName.trim()) {
      push("error", "maintenance.sourceName", "Template source name is required.");
    }
    if (!maintenance.sourceUrl.trim()) {
      push("error", "maintenance.sourceUrl", "Template source URL is required.");
    } else {
      try {
        const parsed = new URL(maintenance.sourceUrl);
        if (!parsed.protocol.startsWith("http")) {
          throw new Error("Template source URL must use http or https.");
        }
      } catch {
        push("error", "maintenance.sourceUrl", "Template source URL must be a valid http(s) URL.");
      }
    }

    const reviewedAt = new Date(maintenance.reviewedAt);
    if (Number.isNaN(reviewedAt.getTime())) {
      push("error", "maintenance.reviewedAt", "Template reviewedAt must be a valid ISO date.");
    } else if (reviewedAt.getTime() > now.getTime()) {
      push("error", "maintenance.reviewedAt", "Template reviewedAt cannot be in the future.");
    }

    if (
      !Number.isInteger(maintenance.reviewCadenceDays) ||
      maintenance.reviewCadenceDays < 1 ||
      maintenance.reviewCadenceDays > 365
    ) {
      push(
        "error",
        "maintenance.reviewCadenceDays",
        "Template review cadence must be an integer between 1 and 365 days."
      );
    }

    if (maintenance.changeNotes.length === 0) {
      push("error", "maintenance.changeNotes", "At least one change note is required.");
    }

    for (const [index, note] of maintenance.changeNotes.entries()) {
      if (!note.trim()) {
        push(
          "error",
          "maintenance.changeNotes",
          `Template change note #${index + 1} must be non-empty.`
        );
      }
    }

    if (
      !issues.some((issue) => issue.templateSlug === template.slug && issue.severity === "error") &&
      resolveAppTemplateFreshness(template, now).status === "stale"
    ) {
      push(
        "warning",
        "maintenance.reviewedAt",
        "Template review window has expired and needs a freshness review."
      );
    }
  }

  return issues;
}
