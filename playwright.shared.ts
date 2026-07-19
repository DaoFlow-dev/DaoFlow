import { PLAYWRIGHT_BASE_URL, PLAYWRIGHT_HEALTHCHECK_URL } from "./e2e/runtime";

const parsedBaseUrl = new URL(PLAYWRIGHT_BASE_URL);
const protocolPort = parsedBaseUrl.protocol === "https:" ? "443" : "80";
const PLAYWRIGHT_SERVER_BUILD_COMMAND =
  process.env.PLAYWRIGHT_SKIP_SERVER_BUILD === "true" ? "" : "bun run build";
// CI uses setup-bun's standard runtime. Do not replace it with Bun's x64 baseline
// build: that binary intermittently crashes during Playwright server runs.
const PLAYWRIGHT_SERVER_START_COMMAND = "bun scripts/supervise-e2e-server.ts";

function joinPlaywrightCommands(...commands: string[]) {
  return commands.filter((command) => command.length > 0).join(" && ");
}

export const playwrightBaseUrl = PLAYWRIGHT_BASE_URL;
export const playwrightHealthcheckUrl = PLAYWRIGHT_HEALTHCHECK_URL;
export const playwrightServerPort = parsedBaseUrl.port || protocolPort;
// The supervisor needs a catchable signal so it can stop the detached Bun server
// and close inherited output pipes before Playwright finishes teardown.
export const playwrightServerGracefulShutdown = {
  signal: "SIGTERM" as const,
  timeout: 10_000
};
export function createPlaywrightServerCommand(...setupCommands: string[]) {
  return joinPlaywrightCommands(
    ...setupCommands,
    PLAYWRIGHT_SERVER_BUILD_COMMAND,
    PLAYWRIGHT_SERVER_START_COMMAND
  );
}
