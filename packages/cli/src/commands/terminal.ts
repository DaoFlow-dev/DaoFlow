import { Command, Option } from "commander";
import { stdin as input, stdout as output } from "node:process";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createAuthenticatedWebSocket } from "../live-websocket";
import { createClient } from "../trpc-client";

const HELP = [
  "",
  "Required scope:",
  "  terminal:open",
  "",
  "Examples:",
  "  daoflow terminal service --service svc_123",
  "  daoflow terminal service --service svc_123 --shell sh",
  "",
  "Notes:",
  "  Requires an interactive TTY.",
  "  --json reports preflight errors only; terminal byte streams are not JSON encoded."
].join("\n");

export function terminalCommand(): Command {
  const command = new Command("terminal")
    .description("Open explicitly gated interactive terminal sessions")
    .addHelpText("after", HELP);

  command
    .command("service")
    .description("Open a shell in a running service container")
    .requiredOption("--service <id>", "Service ID")
    .addOption(new Option("--shell <shell>", "Shell").choices(["bash", "sh"]).default("bash"))
    .option("--json", "Return structured preflight errors")
    .action(
      async (opts: { service: string; shell: "bash" | "sh"; json?: boolean }, command: Command) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const viewer = await createClient().viewer.query();
            if (!viewer.authz.capabilities.includes("terminal:open")) {
              ctx.fail("Terminal access requires terminal:open.", {
                code: "SCOPE_DENIED",
                exitCode: 2,
                extra: {
                  requiredScope: "terminal:open",
                  grantedScopes: viewer.authz.capabilities
                }
              });
            }

            if (ctx.isJson) {
              ctx.fail("Interactive terminal streams cannot be emitted as JSON.", {
                code: "NOT_SUPPORTED"
              });
            }

            if (!input.isTTY || !output.isTTY) {
              ctx.fail("Interactive terminal access requires a TTY.", {
                code: "TTY_REQUIRED"
              });
            }

            await openServiceTerminal({
              serviceId: normalizeCliInput(opts.service, "Service ID"),
              shell: opts.shell
            });
            return ctx.complete();
          }
        });
      }
    );

  return command;
}

async function openServiceTerminal(inputOptions: { serviceId: string; shell: "bash" | "sh" }) {
  await new Promise<void>((resolve, reject) => {
    const ws = createAuthenticatedWebSocket("/ws/docker-terminal", {
      serviceId: inputOptions.serviceId,
      shell: inputOptions.shell
    });
    const stdin = input;
    const wasRaw = stdin.isRaw;

    function cleanup() {
      stdin.off("data", onInput);
      if (stdin.isTTY) {
        stdin.setRawMode(wasRaw);
      }
      stdin.pause();
    }

    function onInput(chunk: Buffer) {
      if (chunk.length === 1 && chunk[0] === 3) {
        ws.close();
        return;
      }
      ws.send(chunk);
    }

    ws.onopen = () => {
      console.error(chalk.dim("Connected. Press Ctrl-C to close."));
      stdin.setRawMode(true);
      stdin.resume();
      stdin.on("data", onInput);
    };
    ws.onmessage = (event) => output.write(String(event.data));
    ws.onerror = () => {
      cleanup();
      reject(new Error("Terminal websocket failed."));
    };
    ws.onclose = () => {
      cleanup();
      resolve();
    };
  });
}
