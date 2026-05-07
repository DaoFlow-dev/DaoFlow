import { Command } from "commander";
import { readFileSync } from "node:fs";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

export function certificateAssetsCommand(): Command {
  const certificates = new Command("certificate").description("Manage custom certificate assets");

  certificates
    .command("list")
    .description("List custom certificate assets")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const certificates = await createClient().certificateAssets.query();
          return ctx.success({ certificates });
        }
      });
    });

  certificates
    .command("create")
    .description("Create a custom certificate asset")
    .requiredOption("--name <name>", "Certificate display name")
    .requiredOption("--cert-file <path>", "Certificate PEM file")
    .option("--private-key-file <path>", "Private key PEM file")
    .option("--ca-chain-file <path>", "CA chain PEM file")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          name: string;
          certFile: string;
          privateKeyFile?: string;
          caChainFile?: string;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const certificatePem = readFileSync(
              normalizeCliInput(opts.certFile, "certificate file", { allowPathTraversal: true }),
              "utf8"
            ).trim();
            const privateKey = opts.privateKeyFile
              ? readFileSync(
                  normalizeCliInput(opts.privateKeyFile, "private key file", {
                    allowPathTraversal: true
                  }),
                  "utf8"
                ).trim()
              : undefined;
            const caChain = opts.caChainFile
              ? readFileSync(
                  normalizeCliInput(opts.caChainFile, "CA chain file", {
                    allowPathTraversal: true
                  }),
                  "utf8"
                ).trim()
              : undefined;
            const name = normalizeCliInput(opts.name, "certificate name");
            ctx.requireConfirmation(
              opts.yes === true,
              `Create certificate asset ${name}. Pass --yes to confirm.`
            );
            const certificate = await createClient().createCertificateAsset.mutate({
              name,
              certificatePem,
              privateKey,
              caChain
            });
            return ctx.success({ certificate }, { quiet: () => certificate.id });
          }
        });
      }
    );

  certificates
    .command("delete")
    .description("Delete a custom certificate asset")
    .requiredOption("--certificate-id <id>", "Certificate asset ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (opts: { certificateId: string; yes?: boolean; json?: boolean }, command: Command) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Delete certificate asset ${opts.certificateId}. Pass --yes to confirm.`
            );
            const result = await createClient().deleteCertificateAsset.mutate({
              certificateId: opts.certificateId
            });
            return ctx.success(result);
          }
        });
      }
    );

  return certificates;
}
