import { describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import { applyDockerOwnershipToComposeDoc } from "./docker-ownership-compose";
import { buildDockerOwnershipLabels } from "./docker-ownership";

const identity = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_123"
};
const ownership = buildDockerOwnershipLabels(identity);

describe("Compose Docker ownership injection", () => {
  it("replaces spoofed required labels in map and list forms while preserving user labels", () => {
    const doc = parseYaml(`
services:
  api:
    build: ./api
    labels:
      io.daoflow.team-id: spoofed
      com.example.role: api
    deploy:
      labels:
        - io.daoflow.project-id=spoofed
        - com.example.tier=web
  worker:
    image: nginx:alpine
    labels:
      - io.daoflow.managed=false
      - com.example.role=worker
`) as Record<string, unknown>;

    applyDockerOwnershipToComposeDoc(doc, identity);
    const services = doc.services as Record<string, Record<string, unknown>>;
    expect(services.api.labels).toMatchObject({
      "com.example.role": "api",
      ...ownership
    });
    expect(services.api.build).toMatchObject({
      context: "./api",
      labels: ownership
    });
    expect(services.api.deploy).toMatchObject({
      labels: expect.arrayContaining([
        "com.example.tier=web",
        ...Object.entries(ownership).map(([key, value]) => `${key}=${value}`)
      ])
    });
    expect(services.worker.labels).toEqual(
      expect.arrayContaining([
        "com.example.role=worker",
        ...Object.entries(ownership).map(([key, value]) => `${key}=${value}`)
      ])
    );
  });

  it("labels non-external resources and the used default network without adopting externals", () => {
    const doc = parseYaml(`
services:
  api:
    image: nginx:alpine
  db:
    image: postgres:16
    networks: [private]
networks:
  private: {}
  proxy:
    external: true
volumes:
  data: {}
  shared:
    external: true
configs:
  app_config:
    file: ./app.conf
  shared_config:
    external: true
secrets:
  app_secret:
    file: ./app.secret
  shared_secret:
    external: true
`) as Record<string, unknown>;

    applyDockerOwnershipToComposeDoc(doc, identity);
    const networks = doc.networks as Record<string, Record<string, unknown>>;
    const volumes = doc.volumes as Record<string, Record<string, unknown>>;
    const configs = doc.configs as Record<string, Record<string, unknown>>;
    const secrets = doc.secrets as Record<string, Record<string, unknown>>;
    expect(networks.private.labels).toEqual(ownership);
    expect(networks.default.labels).toEqual(ownership);
    expect(networks.proxy.labels).toBeUndefined();
    expect(volumes.data.labels).toEqual(ownership);
    expect(volumes.shared.labels).toBeUndefined();
    expect(configs.app_config.labels).toEqual(ownership);
    expect(configs.shared_config.labels).toBeUndefined();
    expect(secrets.app_secret.labels).toEqual(ownership);
    expect(secrets.shared_secret.labels).toBeUndefined();
  });

  it.each(["[]", "{}"])(
    "labels the implicit default network for an empty service networks declaration (%s)",
    (networks) => {
      const doc = parseYaml(`
services:
  api:
    image: nginx:alpine
    networks: ${networks}
`) as Record<string, unknown>;

      applyDockerOwnershipToComposeDoc(doc, identity);

      expect(doc.networks).toMatchObject({
        default: { labels: ownership }
      });
    }
  );
});
