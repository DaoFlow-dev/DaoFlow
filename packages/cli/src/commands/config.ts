/**
 * Task #73: CLI `daoflow config generate-vapid` command.
 * Generates VAPID key pairs for Web Push notifications.
 */
import { Command } from "commander";
import * as crypto from "node:crypto";
import { emitJsonError, emitJsonSuccess, resolveCommandJsonOption } from "../command-helpers";
import { loadConfig, saveConfig } from "../config";

export function registerConfigCommand(program: Command) {
  const config = program.command("config").description("Configuration management utilities");

  config
    .command("generate-vapid")
    .description("Generate VAPID key pair for Web Push notifications")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);

      try {
        // Generate ECDH key pair (P-256 curve, required for VAPID)
        const ecdh = crypto.createECDH("prime256v1");
        ecdh.generateKeys();

        const publicKey = ecdh.getPublicKey("base64url");
        const privateKey = ecdh.getPrivateKey("base64url");

        if (isJson) {
          emitJsonSuccess({
            publicKey,
            privateKey,
            instructions: {
              server: "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables",
              client: "Set VITE_VAPID_PUBLIC_KEY in client .env"
            }
          });
        } else {
          console.log("\n🔐 VAPID Keys Generated\n");
          console.log("Add these to your server environment:");
          console.log(`  VAPID_PUBLIC_KEY=${publicKey}`);
          console.log(`  VAPID_PRIVATE_KEY=${privateKey}`);
          console.log("");
          console.log("Add this to your client .env:");
          console.log(`  VITE_VAPID_PUBLIC_KEY=${publicKey}`);
          console.log("");
          console.log("⚠️  Keep the private key secret. Do not commit it to source control.");
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : "Failed to generate VAPID keys";
        if (isJson) {
          emitJsonError(message, "VAPID_GENERATION_FAILED");
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
    });

  const context = config.command("context").description("Manage CLI authentication contexts");

  context
    .command("list")
    .alias("ls")
    .description("List saved authentication contexts")
    .option("--json", "Output as JSON")
    .action((opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const cfg = loadConfig();
      const names = Object.keys(cfg.contexts);

      if (isJson) {
        emitJsonSuccess({
          currentContext: cfg.currentContext,
          contexts: names.map((name) => ({
            name,
            active: name === cfg.currentContext,
            apiUrl: cfg.contexts[name].apiUrl,
            authMethod: cfg.contexts[name].authMethod ?? "unknown"
          }))
        });
      } else {
        if (names.length === 0) {
          console.log("No contexts configured. Run `daoflow login` to create one.");
        } else {
          for (const name of names) {
            const ctx = cfg.contexts[name];
            const marker = name === cfg.currentContext ? " (active)" : "";
            console.log(`  ${name}${marker}  ${ctx.apiUrl}  [${ctx.authMethod ?? "unknown"}]`);
          }
        }
      }
    });

  context
    .command("use <name>")
    .description("Switch the active authentication context")
    .option("--json", "Output as JSON")
    .action((name: string, opts: { json?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const cfg = loadConfig();

      if (!cfg.contexts[name]) {
        const available = Object.keys(cfg.contexts).join(", ") || "(none)";
        if (isJson) {
          emitJsonError(
            `Context "${name}" not found. Available: ${available}`,
            "CONTEXT_NOT_FOUND"
          );
        } else {
          console.error(`Error: context "${name}" not found. Available: ${available}`);
        }
        process.exit(1);
      }

      cfg.currentContext = name;
      saveConfig(cfg);

      if (isJson) {
        emitJsonSuccess({
          currentContext: name,
          apiUrl: cfg.contexts[name].apiUrl,
          authMethod: cfg.contexts[name].authMethod ?? "unknown"
        });
      } else {
        console.log(`Switched to context "${name}" (${cfg.contexts[name].apiUrl})`);
      }
    });

  context
    .command("delete <name>")
    .description("Remove a saved authentication context")
    .option("--json", "Output as JSON")
    .option("-y, --yes", "Skip confirmation")
    .action((name: string, opts: { json?: boolean; yes?: boolean }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      const cfg = loadConfig();

      if (!cfg.contexts[name]) {
        if (isJson) {
          emitJsonError(`Context "${name}" not found.`, "CONTEXT_NOT_FOUND");
        } else {
          console.error(`Error: context "${name}" not found.`);
        }
        process.exit(1);
      }

      if (name === cfg.currentContext) {
        if (isJson) {
          emitJsonError(
            `Cannot delete the active context "${name}". Switch to another context first.`,
            "CANNOT_DELETE_ACTIVE"
          );
        } else {
          console.error(`Error: cannot delete the active context "${name}". Switch first.`);
        }
        process.exit(1);
      }

      delete cfg.contexts[name];
      saveConfig(cfg);

      if (isJson) {
        emitJsonSuccess({ deleted: name });
      } else {
        console.log(`Deleted context "${name}".`);
      }
    });

  return config;
}
