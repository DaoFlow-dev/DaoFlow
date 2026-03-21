import type { AppTemplateDefinition } from "@daoflow/shared";

export function categoryLabel(category: AppTemplateDefinition["category"]) {
  switch (category) {
    case "application":
      return "Application";
    case "database":
      return "Database";
    case "cache":
      return "Cache";
    case "queue":
      return "Queue";
  }
}

export function defaultFieldValues(template: AppTemplateDefinition) {
  return Object.fromEntries(
    template.fields
      .filter((field) => field.defaultValue)
      .map((field) => [field.key, field.defaultValue ?? ""])
  );
}
