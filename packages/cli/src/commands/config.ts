/**
 * Task #73: CLI `daoflow config generate-vapid` command.
 * Generates VAPID key pairs for Web Push notifications.
 */
import { Command } from "commander";
import * as crypto from "node:crypto";
import { resolveCommandJsonOption } from "../command-helpers";

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
          console.log(
            JSON.stringify(
              {
                ok: true,
                publicKey,
                privateKey,
                instructions: {
                  server: "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables",
                  client: "Set VITE_VAPID_PUBLIC_KEY in client .env"
                }
              },
              null,
              2
            )
          );
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
          console.log(JSON.stringify({ ok: false, error: message }));
        } else {
          console.error(`Error: ${message}`);
        }
        process.exit(1);
      }
    });

  return config;
}
