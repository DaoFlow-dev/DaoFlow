import { expect, test } from "@playwright/test";
import { e2eAdminUser } from "../packages/server/src/testing/e2e-auth-users";
import { createCliHomeDir, getCliConfigMode, runCliJson, removeCliHomeDir } from "./cli-helpers";
import { PLAYWRIGHT_BASE_URL } from "./runtime";

type LoginResponse = {
  ok: boolean;
  data: {
    apiUrl: string;
    context: string;
    authMode: string;
    validated: boolean;
    authMethod: string;
    principalEmail: string | null;
    role: string | null;
  };
};

type WhoAmIResponse = {
  ok: boolean;
  data: {
    principal: {
      email: string;
      name: string | null;
      type: string;
    };
    role: string;
    scopes: string[];
    authMethod: string;
    session: {
      id: string;
      expiresAt: string;
    } | null;
  };
};

type CapabilitiesResponse = {
  ok: boolean;
  data: {
    authMethod: string;
    role: string;
    scopes: string[];
    total: number;
  };
};

type StatusResponse = {
  ok: boolean;
  data: {
    apiUrl: string;
    health: {
      status: string;
      service: string;
    } | null;
    servers: {
      summary: {
        totalServers: number;
        readyServers: number;
        attentionServers: number;
      };
    } | null;
  };
};

test.describe("CLI auth and read flows", () => {
  test("compiled CLI can log in and read live control-plane state", async () => {
    const homeDir = createCliHomeDir();

    try {
      const login = runCliJson<LoginResponse>({
        homeDir,
        args: [
          "login",
          "--url",
          PLAYWRIGHT_BASE_URL,
          "--email",
          e2eAdminUser.email,
          "--password",
          e2eAdminUser.password,
          "--json"
        ]
      });

      expect(login.ok).toBe(true);
      expect(login.data.apiUrl).toBe(PLAYWRIGHT_BASE_URL);
      expect(login.data.context).toBe("default");
      expect(login.data.authMode).toBe("email-password");
      expect(login.data.validated).toBe(true);
      expect(login.data.authMethod).toBe("session");
      expect(login.data.principalEmail).toBe(e2eAdminUser.email);
      expect(login.data.role).toBe("admin");
      expect(getCliConfigMode(homeDir)).toBe(0o600);

      const whoami = runCliJson<WhoAmIResponse>({
        homeDir,
        args: ["whoami", "--json"]
      });

      expect(whoami.ok).toBe(true);
      expect(whoami.data.principal.email).toBe(e2eAdminUser.email);
      expect(whoami.data.role).toBe("admin");
      expect(whoami.data.authMethod).toBe("session");
      expect(whoami.data.scopes.length).toBeGreaterThan(0);
      expect(whoami.data.session).not.toBeNull();

      const capabilities = runCliJson<CapabilitiesResponse>({
        homeDir,
        args: ["capabilities", "--json"]
      });

      expect(capabilities.ok).toBe(true);
      expect(capabilities.data.role).toBe("admin");
      expect(capabilities.data.authMethod).toBe("session");
      expect(capabilities.data.total).toBe(capabilities.data.scopes.length);
      expect(capabilities.data.scopes).toEqual(whoami.data.scopes);

      const status = runCliJson<StatusResponse>({
        homeDir,
        args: ["status", "--json"]
      });

      expect(status.ok).toBe(true);
      expect(status.data.apiUrl).toBe(PLAYWRIGHT_BASE_URL);
      expect(status.data.health?.status).toBe("healthy");
      expect(status.data.health?.service).toBe("daoflow-control-plane");
      expect(status.data.servers).not.toBeNull();
      expect(status.data.servers?.summary.totalServers).toBeGreaterThan(0);
    } finally {
      removeCliHomeDir(homeDir);
    }
  });
});
