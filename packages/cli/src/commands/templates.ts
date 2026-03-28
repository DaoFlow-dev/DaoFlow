import { Command } from "commander";
import chalk from "chalk";
import {
  describeAppTemplateFreshness,
  getAppTemplate,
  listAppTemplates,
  maskTemplateFieldValue,
  renderAppTemplate,
  resolveAppTemplateFreshness,
  type AppTemplateDefinition,
  type RenderedTemplateField
} from "@daoflow/shared";
import { ApiClient, ApiError } from "../api-client";
import { runCommandAction } from "../command-action";
import { fetchComposeDeploymentPlan } from "../compose-deploy-preview";
import { printComposeDeploymentPlan } from "../compose-deployment-plan-output";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

const TEMPLATES_HELP_TEXT = [
  "",
  "Template flows:",
  "  list/show are local catalog reads and do not require API access.",
  "  plan requires --server and uses the normal compose planning lane.",
  "  apply requires --server and --yes and queues a normal direct compose deployment.",
  "",
  "Required scope:",
  "  list/show: none",
  "  plan: deploy:read",
  "  apply: deploy:start",
  "",
  "Examples:",
  "  daoflow templates list",
  "  daoflow templates show postgres --json",
  "  daoflow templates plan postgres --server srv_123 --project-name analytics-db --set postgres_password=secret",
  "  daoflow templates apply n8n --server srv_123 --project-name team-automation --set n8n_domain=n8n.example.com --set n8n_encryption_key=secret --yes",
  "",
  "Example JSON shapes:",
  '  list: { "ok": true, "data": { "templates": [{ "slug": "postgres", ... }] } }',
  '  show: { "ok": true, "data": { "template": { ... } } }',
  '  plan: { "ok": true, "data": { "template": { "slug": "postgres" }, "projectName": "analytics-db", "inputs": [...], "plan": { ... } } }',
  '  apply: { "ok": true, "data": { "template": { "slug": "postgres" }, "projectName": "analytics-db", "serverId": "srv_123", "deploymentId": "dep_123", "inputs": [...] } }'
].join("\n");

interface TemplateInputSummary {
  key: string;
  label: string;
  kind: RenderedTemplateField["kind"];
  value: string;
  isSecret: boolean;
}

function collectValues(value: string, previous: string[] = []) {
  previous.push(value);
  return previous;
}

function getTemplateOrThrow(slug: string): AppTemplateDefinition {
  const template = getAppTemplate(normalizeCliInput(slug, "Template slug"));
  if (!template) {
    throw new Error(`Unknown app template "${slug}".`);
  }

  return template;
}

function parseTemplateOverrides(pairs: string[] | undefined) {
  const overrides: Record<string, string> = {};

  for (const pair of pairs ?? []) {
    const separatorIndex = pair.indexOf("=");
    if (separatorIndex <= 0) {
      throw new Error(`Template override "${pair}" must use KEY=VALUE format.`);
    }

    const key = pair.slice(0, separatorIndex).trim();
    const value = pair.slice(separatorIndex + 1).trim();
    if (!key) {
      throw new Error(`Template override "${pair}" is missing a key.`);
    }
    if (
      [...value].some((char) => {
        const code = char.charCodeAt(0);
        return code === 0 || code === 10 || code === 13;
      })
    ) {
      throw new Error(`Template override "${key}" contains unsupported control characters.`);
    }

    overrides[key] = value;
  }

  return overrides;
}

function summarizeTemplateInputs(fields: RenderedTemplateField[]): TemplateInputSummary[] {
  return fields.map((field) => ({
    key: field.key,
    label: field.label,
    kind: field.kind,
    value: maskTemplateFieldValue(field.value, field.kind === "secret"),
    isSecret: field.kind === "secret"
  }));
}

function printTemplateInputs(inputs: TemplateInputSummary[]) {
  if (inputs.length === 0) {
    return;
  }

  console.log(`  ${chalk.bold("Inputs:")}`);
  for (const input of inputs) {
    console.log(`    ${chalk.cyan(input.key)}  ${input.value || "—"}  (${input.kind})`);
  }
  console.log();
}

function printTemplateMetadata(template: AppTemplateDefinition) {
  const freshness = resolveAppTemplateFreshness(template);

  console.log(chalk.bold(`\n  ${template.name}\n`));
  console.log(`  Slug:      ${template.slug}`);
  console.log(`  Category:  ${template.category}`);
  console.log(`  Summary:   ${template.summary}`);
  console.log(`  Default:   ${template.defaultProjectName}`);
  console.log(`  Tags:      ${template.tags.join(", ")}`);
  console.log(`  Version:   ${template.maintenance.version}`);
  console.log(`  Source:    ${template.maintenance.sourceName}`);
  console.log(`  Reviewed:  ${freshness.reviewedAt.slice(0, 10)}`);
  console.log(`  Due:       ${freshness.reviewDueAt.slice(0, 10)}`);
  console.log(`  Freshness: ${describeAppTemplateFreshness(freshness.status)}`);
  console.log();

  console.log(`  ${chalk.bold("Services:")}`);
  for (const service of template.services) {
    console.log(`    ${chalk.cyan(service.name)}  ${service.role}  ${service.summary}`);
  }
  console.log();

  console.log(`  ${chalk.bold("Inputs:")}`);
  for (const field of template.fields) {
    const example = field.defaultValue ?? field.exampleValue ?? "required";
    console.log(`    ${chalk.cyan(field.key)}  ${field.kind}  ${example}`);
    console.log(chalk.dim(`      ${field.description}`));
  }
  console.log();

  console.log(`  ${chalk.bold("Volumes:")}`);
  for (const volume of template.volumes) {
    console.log(`    ${volume.nameTemplate} -> ${volume.mountPath}`);
  }
  console.log();

  console.log(`  ${chalk.bold("Health checks:")}`);
  for (const check of template.healthChecks) {
    console.log(`    ${chalk.cyan(check.serviceName)}  ${check.summary}`);
  }
  console.log();

  console.log(`  ${chalk.bold("Latest review notes:")}`);
  for (const note of template.maintenance.changeNotes) {
    console.log(`    - ${note}`);
  }
  console.log();
}

function normalizeDeployError(error: unknown): Error {
  if (error instanceof ApiError) {
    try {
      const body = JSON.parse(error.body) as { error?: string };
      return new Error(body.error ?? error.message);
    } catch {
      return new Error(error.body || error.message);
    }
  }

  return error instanceof Error ? error : new Error(String(error));
}

function summarizeCatalogTemplate(template: AppTemplateDefinition) {
  const freshness = resolveAppTemplateFreshness(template);

  return {
    slug: template.slug,
    name: template.name,
    category: template.category,
    summary: template.summary,
    tags: template.tags,
    defaultProjectName: template.defaultProjectName,
    serviceCount: template.services.length,
    fieldCount: template.fields.length,
    maintenance: template.maintenance,
    freshness
  };
}

export function templatesCommand(): Command {
  const cmd = new Command("templates").description(
    "Browse and instantiate curated Compose app templates"
  );
  cmd.addHelpText("after", TEMPLATES_HELP_TEXT);

  cmd
    .command("list")
    .option("--json", "Output as JSON")
    .description("List curated app templates")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          await Promise.resolve();
          const templates = listAppTemplates();
          const summarizedTemplates = templates.map(summarizeCatalogTemplate);
          return ctx.success(
            {
              templates: summarizedTemplates
            },
            {
              human: () => {
                console.log(chalk.bold("\n  App Templates\n"));
                for (const template of summarizedTemplates) {
                  console.log(`  ${chalk.cyan(template.name)}  (${template.slug})`);
                  console.log(
                    chalk.dim(
                      `    ${template.category} · ${template.maintenance.version} · ${describeAppTemplateFreshness(template.freshness.status)}`
                    )
                  );
                  console.log(chalk.dim(`    ${template.summary}`));
                }
                console.log();
              }
            }
          );
        }
      });
    });

  cmd
    .command("show")
    .argument("<slug>", "Template slug")
    .option("--json", "Output as JSON")
    .description("Inspect one app template")
    .action(async (slug: string, opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          await Promise.resolve();
          const template = getTemplateOrThrow(slug);
          return ctx.success(
            {
              template: {
                ...summarizeCatalogTemplate(template),
                description: template.description,
                services: template.services,
                fields: template.fields,
                volumes: template.volumes,
                healthChecks: template.healthChecks
              }
            },
            {
              human: () => printTemplateMetadata(template)
            }
          );
        }
      });
    });

  cmd
    .command("plan")
    .argument("<slug>", "Template slug")
    .requiredOption("--server <id>", "Target server ID")
    .option("--project-name <name>", "Project and stack name override")
    .option("--set <key=value>", "Template field override", collectValues, [])
    .option("--json", "Output as JSON")
    .description("Render a template into a normal direct compose deployment plan")
    .action(
      async (
        slug: string,
        opts: {
          server: string;
          projectName?: string;
          set?: string[];
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const template = getTemplateOrThrow(slug);
            const rendered = renderAppTemplate({
              slug: template.slug,
              projectName: opts.projectName,
              values: parseTemplateOverrides(opts.set)
            });
            const trpc = createClient();
            const plan = await fetchComposeDeploymentPlan(trpc, {
              composePath: `templates/${template.slug}.yaml`,
              composeFiles: [
                {
                  path: `templates/${template.slug}.yaml`,
                  contents: rendered.compose
                }
              ],
              contextPath: ".",
              serverId: normalizeCliInput(opts.server, "Server ID")
            });
            const inputs = summarizeTemplateInputs(rendered.fields);

            return ctx.success(
              {
                template: {
                  slug: template.slug,
                  name: template.name
                },
                projectName: rendered.projectName,
                inputs,
                plan
              },
              {
                human: () => {
                  console.log(chalk.bold(`\n  Template Plan: ${template.name}\n`));
                  console.log(`  Template:  ${template.slug}`);
                  console.log(`  Project:   ${rendered.projectName}`);
                  console.log(`  Server:    ${opts.server}`);
                  console.log();
                  printTemplateInputs(inputs);
                  printComposeDeploymentPlan(plan, {
                    title: "Rendered Template Plan",
                    subtitle: "This plan will NOT be executed."
                  });
                }
              }
            );
          }
        });
      }
    );

  cmd
    .command("apply")
    .argument("<slug>", "Template slug")
    .requiredOption("--server <id>", "Target server ID")
    .option("--project-name <name>", "Project and stack name override")
    .option("--set <key=value>", "Template field override", collectValues, [])
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .description("Render a template and queue a normal direct compose deployment")
    .action(
      async (
        slug: string,
        opts: {
          server: string;
          projectName?: string;
          set?: string[];
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const template = getTemplateOrThrow(slug);
            const rendered = renderAppTemplate({
              slug: template.slug,
              projectName: opts.projectName,
              values: parseTemplateOverrides(opts.set)
            });
            const serverId = normalizeCliInput(opts.server, "Server ID");
            const inputs = summarizeTemplateInputs(rendered.fields);

            ctx.requireConfirmation(
              opts.yes === true,
              `Instantiate template ${template.slug} on ${serverId}. Pass --yes to confirm.`,
              {
                humanMessage: `Instantiate template ${template.slug} on ${serverId}. Pass --yes to confirm.`
              }
            );

            try {
              const api = new ApiClient();
              const response = await api.post<{
                ok: boolean;
                deploymentId: string;
              }>(
                "/api/v1/deploy/compose",
                {
                  server: serverId,
                  compose: rendered.compose,
                  project: rendered.projectName
                },
                {
                  idempotencyKey: ctx.idempotencyKey
                }
              );

              return ctx.success(
                {
                  template: {
                    slug: template.slug,
                    name: template.name
                  },
                  projectName: rendered.projectName,
                  serverId,
                  deploymentId: response.deploymentId,
                  inputs
                },
                {
                  quiet: () => response.deploymentId,
                  human: () => {
                    console.log(chalk.green(`✓ Queued ${template.name} template deployment`));
                    console.log(chalk.dim(`  Deployment: ${response.deploymentId}`));
                    console.log(chalk.dim(`  Project: ${rendered.projectName}`));
                    console.log(chalk.dim(`  Server: ${serverId}`));
                    console.log();
                    printTemplateInputs(inputs);
                  }
                }
              );
            } catch (error) {
              throw normalizeDeployError(error);
            }
          }
        });
      }
    );

  return cmd;
}
