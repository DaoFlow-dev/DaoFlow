import {
  describeAppTemplateFreshness,
  inspectAppTemplates,
  listAppTemplates,
  resolveAppTemplateFreshness
} from "../packages/shared/src";

const args = new Set(Bun.argv.slice(2));
const reportRequested = args.has("--report");
const templates = listAppTemplates();
const issues = inspectAppTemplates(templates);
const errors = issues.filter((issue) => issue.severity === "error");
const warnings = issues.filter((issue) => issue.severity === "warning");

if (reportRequested) {
  console.log("DaoFlow template freshness report\n");
  console.table(
    templates.map((template) => {
      const freshness = resolveAppTemplateFreshness(template);
      return {
        slug: template.slug,
        version: template.maintenance.version,
        freshness: describeAppTemplateFreshness(freshness.status),
        reviewedAt: freshness.reviewedAt.slice(0, 10),
        reviewDueAt: freshness.reviewDueAt.slice(0, 10),
        source: template.maintenance.sourceName
      };
    })
  );
}

if (warnings.length > 0) {
  console.warn("\nTemplate freshness warnings:");
  for (const issue of warnings) {
    console.warn(`- ${issue.templateSlug} (${issue.field}): ${issue.message}`);
  }
}

if (errors.length > 0) {
  console.error("\nTemplate catalog validation failed:");
  for (const issue of errors) {
    console.error(`- ${issue.templateSlug} (${issue.field}): ${issue.message}`);
  }
  process.exit(1);
}

console.log("App template catalog metadata is valid.");
