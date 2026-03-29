import { PLAYWRIGHT_BASE_URL, PLAYWRIGHT_HEALTHCHECK_URL } from "./e2e/runtime";

const parsedBaseUrl = new URL(PLAYWRIGHT_BASE_URL);
const protocolPort = parsedBaseUrl.protocol === "https:" ? "443" : "80";
const PLAYWRIGHT_SERVER_BUILD_COMMAND = "bun run build";
// Keep Playwright off the dist entry because Bun intermittently crashed there in CI.
const PLAYWRIGHT_SERVER_START_COMMAND = "bun run start:e2e";

function joinPlaywrightCommands(...commands: string[]) {
  return commands.filter((command) => command.length > 0).join(" && ");
}

export const playwrightBaseUrl = PLAYWRIGHT_BASE_URL;
export const playwrightHealthcheckUrl = PLAYWRIGHT_HEALTHCHECK_URL;
export const playwrightServerPort = parsedBaseUrl.port || protocolPort;
export function createPlaywrightServerCommand(...setupCommands: string[]) {
  return joinPlaywrightCommands(
    ...setupCommands,
    PLAYWRIGHT_SERVER_BUILD_COMMAND,
    PLAYWRIGHT_SERVER_START_COMMAND
  );
}
