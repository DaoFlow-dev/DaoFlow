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
import {
  emitJsonError,
  emitJsonSuccess,
  getErrorMessage,
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
        },
        command: Command
      ) => {
        const isJson = resolveCommandJsonOption(command, opts.json);

        // Validate preset name
        if (opts.preset && !PRESET_NAMES.includes(opts.preset as PresetName)) {
          const msg = `Invalid preset "${opts.preset}". Use: ${PRESET_NAMES.join(", ")}`;
          if (isJson) {
            emitJsonError(msg, "INVALID_PRESET");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
          }
          process.exit(1);
        }

        // Require either preset or scopes
        if (!opts.preset && !opts.scopes) {
          const msg = "Either --preset or --scopes is required.";
          if (isJson) {
            emitJsonError(msg, "MISSING_SCOPES");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
            console.error(
              chalk.dim("  daoflow token create --name my-agent --preset agent:read-only")
            );
          }
          process.exit(1);
        }

        // Cannot use both
        if (opts.preset && opts.scopes) {
          const msg = "Use either --preset or --scopes, not both.";
          if (isJson) {
            emitJsonError(msg, "AMBIGUOUS_SCOPES");
          } else {
            console.error(chalk.red(`✗ ${msg}`));
          }
          process.exit(1);
        }

        // Show confirmation
        if (!opts.yes) {
          if (isJson) {
            emitJsonError(
              `Creating agent token ${opts.name} requires --yes to confirm.`,
              "CONFIRMATION_REQUIRED"
            );
            process.exit(1);
            return;
          }

          const presetInfo = opts.preset ? PRESETS[opts.preset as PresetName] : null;
          const scopeList = presetInfo
            ? presetInfo.scopes
            : (opts.scopes ?? "").split(",").map((s) => s.trim());

          console.log(chalk.bold("\n  Create Agent Token\n"));
          console.log(`  Name:     ${opts.name}`);
          if (opts.preset) console.log(`  Preset:   ${chalk.cyan(opts.preset)}`);
          if (opts.description) console.log(`  Desc:     ${opts.description}`);
          console.log(`  Scopes:   ${scopeList.length} scope(s)`);
          if (opts.expires) console.log(`  Expires:  ${opts.expires} days`);
          console.log();
          console.error(chalk.yellow("  Pass --yes to confirm, or --dry-run to preview."));
          process.exit(1);
        }

        try {
          const trpc = createClient();

          if (!isJson) console.log(chalk.blue("⟳ Creating agent..."));

          // Step 1: Create agent principal
          const createInput: CreateAgentInput = {
            name: opts.name,
            description: opts.description
          };
          if (opts.preset) {
            createInput.preset = opts.preset;
          } else if (opts.scopes) {
            createInput.scopes = opts.scopes.split(",").map((s) => s.trim());
          }

          const agent = await trpc.createAgent.mutate(createInput);

          // Step 2: Generate token
          const tokenResult = await trpc.generateAgentToken.mutate({
            principalId: agent.id,
            tokenName: `${opts.name}-token`,
            expiresInDays: opts.expires
          });

          if (isJson) {
            emitJsonSuccess({
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
            });
          } else {
            console.log(chalk.green("✓ Agent created and token generated\n"));
            console.log(`  Agent ID:  ${chalk.dim(agent.id)}`);
            console.log(`  Name:      ${agent.name}`);
            if (opts.preset) console.log(`  Preset:    ${chalk.cyan(opts.preset)}`);
            console.log(`  Token:     ${chalk.yellow(tokenResult.tokenValue)}`);
            console.log();
            console.log(chalk.red("  ⚠ Save this token — it will not be shown again."));
            console.log();
          }
        } catch (err) {
          if (isJson) {
            emitJsonError(getErrorMessage(err), "API_ERROR");
          } else {
            console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
          }
          process.exit(1);
        }
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
      const isJson = resolveCommandJsonOption(command, opts.json);

      if (!opts.yes) {
        const error = `Destructive operation — revoking token ${opts.id}. Pass --yes to confirm.`;
        if (isJson) {
          emitJsonError(error, "CONFIRMATION_REQUIRED");
        } else {
          console.error(chalk.yellow(error));
        }
        process.exit(1);
        return;
      }

      try {
        const trpc = createClient();
        const result = await trpc.revokeAgentToken.mutate({ tokenId: opts.id });

        if (isJson) {
          emitJsonSuccess(result);
        } else {
          console.log(chalk.green(`✓ Token ${opts.id} revoked`));
        }
      } catch (err) {
        if (isJson) {
          emitJsonError(getErrorMessage(err), "API_ERROR");
        } else {
          console.error(chalk.red(`✗ ${err instanceof Error ? err.message : String(err)}`));
        }
        process.exit(1);
      }
    });

  return cmd;
}
