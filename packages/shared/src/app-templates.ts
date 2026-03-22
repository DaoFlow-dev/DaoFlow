import { applicationAppTemplates } from "./app-template-catalog-applications";
import { infrastructureAppTemplates } from "./app-template-catalog-infrastructure";
import type {
  AppTemplateDefinition,
  AppTemplateFieldDefinition,
  RenderedAppTemplate
} from "./app-template-types";

export type {
  AppTemplateCategory,
  AppTemplateDefinition,
  AppTemplateFieldDefinition,
  AppTemplateFieldKind,
  AppTemplateHealthCheckDefinition,
  AppTemplateServiceDefinition,
  AppTemplateVolumeDefinition,
  RenderedAppTemplate,
  RenderedTemplateField
} from "./app-template-types";

const APP_TEMPLATE_DEFINITIONS = [
  ...infrastructureAppTemplates,
  ...applicationAppTemplates
] as const satisfies readonly AppTemplateDefinition[];

function templateFieldToken(key: string): string {
  return key
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function sanitizeProjectName(value: string, fallback: string): string {
  const cleaned = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  return cleaned.slice(0, 63) || fallback;
}

function requireTemplate(slug: string): AppTemplateDefinition {
  const template = APP_TEMPLATE_DEFINITIONS.find((candidate) => candidate.slug === slug);
  if (!template) {
    throw new Error(`Unknown app template "${slug}".`);
  }

  return template;
}

function renderTemplateString(template: string, replacements: Record<string, string>): string {
  return template.replace(/\{\{([A-Z0-9_]+)\}\}/g, (match, token: string) => {
    const replacement = replacements[token];
    if (replacement === undefined) {
      throw new Error(`Template token ${token} is not defined.`);
    }

    // Escape Compose/YAML-sensitive characters before injecting values into
    // double-quoted strings so operators can safely use $, " and \ in secrets.
    return replacement.replace(/\\/g, "\\\\").replace(/\$/g, "$$$$").replace(/"/g, '\\"');
  });
}

function validateFieldValue(field: AppTemplateFieldDefinition, value: string): void {
  if (!value && !field.required) {
    return;
  }

  if (value.length > 255) {
    throw new Error(`Template field "${field.label}" exceeds the 255 character limit.`);
  }

  if (
    [...value].some((char) => {
      const code = char.charCodeAt(0);
      return code === 0 || code === 10 || code === 13;
    })
  ) {
    throw new Error(`Template field "${field.label}" contains unsupported control characters.`);
  }

  if (field.kind === "port") {
    const parsed = Number(value);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      throw new Error(`Template field "${field.label}" must be a valid TCP port.`);
    }
  }

  if (field.kind === "domain") {
    if (
      value.includes("://") ||
      !/^[a-zA-Z0-9.-]+(?::[0-9]{1,5})?$/.test(value) ||
      value.startsWith(".") ||
      value.endsWith(".")
    ) {
      throw new Error(`Template field "${field.label}" must be a bare host or host:port.`);
    }
  }
}

export function listAppTemplates(): AppTemplateDefinition[] {
  return [...APP_TEMPLATE_DEFINITIONS];
}

export function getAppTemplate(slug: string): AppTemplateDefinition | undefined {
  return APP_TEMPLATE_DEFINITIONS.find((template) => template.slug === slug);
}

export function maskTemplateFieldValue(value: string, isSecret: boolean): string {
  if (!isSecret) {
    return value;
  }

  return value.length > 0 ? "••••••••" : "";
}

export function renderAppTemplate(input: {
  slug: string;
  projectName?: string;
  values?: Record<string, string | undefined>;
}): RenderedAppTemplate {
  const template = requireTemplate(input.slug);
  const stackName = sanitizeProjectName(
    input.projectName ?? template.defaultProjectName,
    template.slug
  );
  const allowedKeys = new Set(template.fields.map((field) => field.key));

  for (const key of Object.keys(input.values ?? {})) {
    if (!allowedKeys.has(key)) {
      throw new Error(`Template field "${key}" is not defined for ${template.slug}.`);
    }
  }

  const fields = template.fields.map((field) => {
    const rawValue = input.values?.[field.key] ?? field.defaultValue ?? "";
    const value = rawValue.trim();

    if (field.required && value.length === 0) {
      throw new Error(`Template field "${field.label}" is required.`);
    }

    validateFieldValue(field, value);

    return {
      ...field,
      value
    };
  });

  const replacements: Record<string, string> = {
    STACK_NAME: stackName
  };

  for (const field of fields) {
    replacements[templateFieldToken(field.key)] = field.value;
  }

  return {
    template,
    projectName: stackName,
    stackName,
    fields,
    compose: renderTemplateString(template.composeTemplate, replacements)
  };
}
