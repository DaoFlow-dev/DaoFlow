import { PLAYWRIGHT_BASE_URL, PLAYWRIGHT_HEALTHCHECK_URL } from "./e2e/runtime";

const parsedBaseUrl = new URL(PLAYWRIGHT_BASE_URL);
const protocolPort = parsedBaseUrl.protocol === "https:" ? "443" : "80";

export const playwrightBaseUrl = PLAYWRIGHT_BASE_URL;
export const playwrightHealthcheckUrl = PLAYWRIGHT_HEALTHCHECK_URL;
export const playwrightServerPort = parsedBaseUrl.port || protocolPort;
