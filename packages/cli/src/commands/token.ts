/**
 * token.ts — Agent token management.
 *
 * Per AGENTS.md §20 Command Scope Map:
 *   token presets  → read lane, any valid token
 *   token create   → command lane, tokens:manage
 *   token list     → read lane, tokens:manage
 *   token revoke   → command lane, tokens:manage
 *
 * Supports presets: agent:read-only, agent:minimal-write, agent:full
 */

import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
  normalizeCliInput,
  normalizeOptionalCliInput,
  resolveCommandJsonOption
} from "../command-helpers";
import { createClient, type CreateAgentInput } from "../trpc-client";

// ── Inline preset definitions (mirrored from @daoflow/shared for CLI use)
// We inline these to avoid import issues with the shared package in CLI binary builds.
const PRESETS = {
  "agent:read-only": {
    label: "Read-Only Agent",
    description: "Observe infrastructure, read logs, view deployments. Zero mutations.",
    lanes: ["read"],
    scopes: [
      "server:read",
      "deploy:read",
      "service:read",
      "env:read",
      "volumes:read",
      "backup:read",
      "logs:read",
      "events:read",
      "diagnostics:read"
    ]
  },
  "agent:minimal-write": {
    label: "Minimal Write Agent",
    description:
      "Deploy, rollback, write env vars/secrets, and request approvals. No infra mutations.",
    lanes: ["read", "command"],
    scopes: [
      "server:read",
      "deploy:read",
      "deploy:start",
      "deploy:cancel",
      "deploy:rollback",
      "service:read",
      "env:read",
      "env:write",
      "secrets:read",
      "secrets:write",
      "volumes:read",
      "backup:read",
      "logs:read",
      "events:read",
      "diagnostics:read",
      "approvals:create"
    ]
  },
  "agent:full": {
    label: "Full Agent",
    description:
      "Full operational capability except admin actions (terminal, policy, members, tokens).",
    lanes: ["read", "planning", "command"],
    scopes: [
      "server:read",
      "server:write",
      "deploy:read",
      "deploy:start",
      "deploy:cancel",
      "deploy:rollback",
      "service:read",
      "service:update",
      "env:read",
      "env:write",
      "secrets:read",
      "secrets:write",
      "volumes:read",
      "volumes:write",
      "backup:read",
      "backup:run",
      "backup:restore",
      "logs:read",
      "events:read",
      "diagnostics:read",
      "approvals:create",
      "approvals:decide"
    ]
  }
} as const;

type PresetName = keyof typeof PRESETS;

const PRESET_NAMES = Object.keys(PRESETS) as PresetName[];

export function tokenCommand(): Command {
  const cmd = new Command("token").description("Manage agent tokens and presets");

  // ── daoflow token presets ─────────────────────────────────
  cmd
    .command("presets")
    .description("List available agent token presets")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const presetList = PRESET_NAMES.map((name) => ({
        name,
        label: PRESETS[name].label,
        description: PRESETS[name].description,
        lanes: PRESETS[name].lanes,
        scopeCount: PRESETS[name].scopes.length
      }));

      if (isJson) {
        emitJsonSuccess({ presets: presetList });
        return;
      }

      console.log(chalk.bold("\n  Agent Token Presets\n"));
      for (const p of presetList) {
        console.log(`  ${chalk.cyan(p.name)}`);
        console.log(`    ${chalk.dim(p.label)} — ${p.description}`);
        console.log(`    Lanes: ${p.lanes.join(", ")}  |  Scopes: ${p.scopeCount}`);
        console.log();
      }

      console.log(
        chalk.dim("  Usage: daoflow token create --preset agent:read-only --name my-agent\n")
      );
    });

  // ── daoflow token create ──────────────────────────────────
  cmd
    .command("create")
    .description("Create an agent with a token (requires tokens:manage scope)")
    .requiredOption("--name <name>", "Agent name")
    .option("--preset <preset>", "Agent preset (agent:read-only, agent:minimal-write, agent:full)")
    .option("--scopes <scopes>", "Comma-separated scopes (alternative to --preset)")
    .option("--description <desc>", "Agent description")
    .option("--expires <days>", "Token expiry in days", parseInt)
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--dry-run", "Preview the token creation payload without mutating")
    .action(
      async (
        opts: {
          name: string;
          preset?: string;
          scopes?: string;
          description?: string;
          expires?: number;
          json?: boolean;
          yes?: boolean;
          dryRun?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<unknown>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const name = normalizeCliInput(opts.name, "Agent name");
            const description = normalizeOptionalCliInput(opts.description, "Agent description", {
              maxLength: 512
            });

            if (opts.preset && !PRESET_NAMES.includes(opts.preset as PresetName)) {
              ctx.fail(`Invalid preset "${opts.preset}". Use: ${PRESET_NAMES.join(", ")}`, {
                code: "INVALID_PRESET"
              });
            }

            if (!opts.preset && !opts.scopes) {
              ctx.fail("Either --preset or --scopes is required.", {
                code: "MISSING_SCOPES"
              });
            }

            if (opts.preset && opts.scopes) {
              ctx.fail("Use either --preset or --scopes, not both.", {
                code: "AMBIGUOUS_SCOPES"
              });
            }

            const scopes = opts.scopes
              ? opts.scopes
                  .split(",")
                  .map((scope) => normalizeCliInput(scope, "Scope", { allowPathTraversal: true }))
              : undefined;
            const presetInfo = opts.preset ? PRESETS[opts.preset as PresetName] : null;
            const scopeList = presetInfo ? presetInfo.scopes : (scopes ?? []);

            if (opts.dryRun) {
              return ctx.dryRun(
                {
                  dryRun: true,
                  name,
                  description: description ?? null,
                  preset: opts.preset ?? null,
                  scopes: scopeList,
                  expiresInDays: opts.expires ?? null
                },
                {
                  quiet: () => name,
                  human: () => {
                    console.log(chalk.bold("\n  Create Agent Token (dry-run)\n"));
                    console.log(`  Name:     ${name}`);
                    if (opts.preset) console.log(`  Preset:   ${chalk.cyan(opts.preset)}`);
                    if (description) console.log(`  Desc:     ${description}`);
                    console.log(`  Scopes:   ${scopeList.length} scope(s)`);
                    if (opts.expires) console.log(`  Expires:  ${opts.expires} days`);
                    console.log();
                  }
                }
              );
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Creating agent token ${name} requires --yes to confirm.`,
              {
                humanMessage: `Creating agent token ${name} requires --yes to confirm.`
              }
            );

            try {
              const trpc = createClient();

              const createInput: CreateAgentInput = {
                name,
                description
              };
              if (opts.preset) {
                createInput.preset = opts.preset;
              } else if (scopes) {
                createInput.scopes = scopes;
              }

              const agent = await trpc.createAgent.mutate(createInput);
              const tokenResult = await trpc.generateAgentToken.mutate({
                principalId: agent.id,
                tokenName: `${name}-token`,
                expiresInDays: opts.expires
              });

              return ctx.success(
                {
                  agent: {
                    id: agent.id,
                    name: agent.name,
                    scopes: (agent.defaultScopes ?? "").split(",").filter(Boolean)
                  },
                  token: {
                    id: tokenResult.token.id,
                    value: tokenResult.tokenValue,
                    prefix: tokenResult.token.tokenPrefix
                  },
                  preset: opts.preset ?? null
                },
                {
                  quiet: () => tokenResult.tokenValue,
                  human: () => {
                    console.log(chalk.green("✓ Agent created and token generated\n"));
                    console.log(`  Agent ID:  ${chalk.dim(agent.id)}`);
                    console.log(`  Name:      ${agent.name}`);
                    if (opts.preset) console.log(`  Preset:    ${chalk.cyan(opts.preset)}`);
                    console.log(`  Token:     ${chalk.yellow(tokenResult.tokenValue)}`);
                    console.log();
                    console.log(chalk.red("  ⚠ Save this token — it will not be shown again."));
                    console.log();
                  }
                }
              );
            } catch (error) {
              ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
            }
          }
        });
      }
    );

  // ── daoflow token list ────────────────────────────────────
  cmd
    .command("list")
    .description("List agent tokens")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        const trpc = createClient();
        const inventory = await trpc.agentTokenInventory.query();

        if (isJson) {
          emitJsonSuccess(inventory);
          return;
        }

        console.log(chalk.bold(`\n  Agent Tokens (${inventory.summary.totalTokens})\n`));

        if (inventory.tokens.length === 0) {
          console.log(chalk.dim("  No tokens found. Create one with: daoflow token create\n"));
          return;
        }

        for (const t of inventory.tokens) {
          const status = t.status === "active" ? chalk.green("active") : chalk.red(t.status);
          console.log(`  ${chalk.cyan(t.name)}  ${status}`);
          console.log(
            `    Prefix: ${t.tokenPrefix ?? "—"}  |  Created: ${new Date(t.createdAt).toLocaleDateString()}`
          );
        }
        console.log();
      } catch (err) {
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });

  // ── daoflow token revoke ──────────────────────────────────
  cmd
    .command("revoke")
    .description("Revoke an agent token")
    .requiredOption("--id <tokenId>", "Token ID to revoke")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .action(async (opts: { id: string; json?: boolean; yes?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const tokenId = normalizeCliInput(opts.id, "Token ID");

          ctx.requireConfirmation(
            opts.yes === true,
            `Destructive operation — revoking token ${tokenId}. Pass --yes to confirm.`
          );

          try {
            const trpc = createClient();
            const result = await trpc.revokeAgentToken.mutate({ tokenId });

            return ctx.success(result, {
              quiet: () => tokenId,
              human: () => {
                console.log(chalk.green(`✓ Token ${tokenId} revoked`));
              }
            });
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  return cmd;
}
