import type { ManagedTraefikRoutingPlan } from "./managed-traefik";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function mergeLabels(service: Record<string, unknown>, labels: Record<string, string>) {
  const existing = service.labels;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    service.labels = {
      ...(existing as Record<string, unknown>),
      ...labels
    };
    return;
  }

  const existingLabels = Array.isArray(existing) ? (existing as unknown[]) : [];
  const next = existingLabels.filter(
    (label) =>
      typeof label !== "string" || !Object.keys(labels).some((key) => label.startsWith(`${key}=`))
  );

  service.labels = [...next, ...Object.entries(labels).map(([key, value]) => `${key}=${value}`)];
}

function attachNetwork(service: Record<string, unknown>, networkName: string) {
  const existing = service.networks;
  if (existing && typeof existing === "object" && !Array.isArray(existing)) {
    service.networks = {
      ...(existing as Record<string, unknown>),
      [networkName]: asRecord((existing as Record<string, unknown>)[networkName])
    };
    return;
  }

  if (Array.isArray(existing)) {
    const existingNetworks = existing as unknown[];
    service.networks = existingNetworks.includes(networkName)
      ? existingNetworks
      : [...existingNetworks, networkName];
    return;
  }

  service.networks = [networkName];
}

export function applyManagedTraefikRoutingToComposeDoc(
  doc: Record<string, unknown>,
  plan: ManagedTraefikRoutingPlan | null
) {
  if (!plan || plan.routes.length === 0) {
    return;
  }

  const services = asRecord(doc.services);
  const networks = asRecord(doc.networks);
  doc.networks = {
    ...networks,
    [plan.proxy.networkName]: {
      ...asRecord(networks[plan.proxy.networkName]),
      external: true
    }
  };

  for (const route of plan.routes) {
    const service = asRecord(services[route.targetServiceName]);
    if (Object.keys(service).length === 0) {
      continue;
    }

    attachNetwork(service, route.networkName);
    const labels: Record<string, string> = {
      "traefik.enable": "true",
      "traefik.docker.network": route.networkName,
      [`traefik.http.routers.${route.routerName}.rule`]: `Host(\`${route.hostname}\`)`,
      [`traefik.http.routers.${route.routerName}.entrypoints`]: route.entrypoint,
      [`traefik.http.routers.${route.routerName}.tls`]: "true",
      [`traefik.http.routers.${route.routerName}.tls.certresolver`]: route.certificateResolver,
      [`traefik.http.services.${route.traefikServiceName}.loadbalancer.server.port`]: String(
        route.targetPort
      )
    };

    if (route.middlewares && route.middlewares.length > 0) {
      const middlewareNames: string[] = [];
      for (const mw of route.middlewares) {
        const mwName = `${route.routerName}-${mw.name}`;
        middlewareNames.push(mwName);
        const prefix = `traefik.http.middlewares.${mwName}`;
        switch (mw.type) {
          case "redirect-https":
            labels[`${prefix}.redirectscheme.scheme`] = "https";
            labels[`${prefix}.redirectscheme.permanent`] = "true";
            break;
          case "basic-auth":
            if (typeof mw.config.users === "string") {
              labels[`${prefix}.basicauth.users`] = mw.config.users;
            }
            break;
          case "strip-prefix":
            if (Array.isArray(mw.config.prefixes)) {
              labels[`${prefix}.stripprefix.prefixes`] = (mw.config.prefixes as string[]).join(",");
            }
            break;
          case "headers":
            if (mw.config.customRequestHeaders) {
              for (const [k, v] of Object.entries(
                mw.config.customRequestHeaders as Record<string, string>
              )) {
                labels[`${prefix}.headers.customrequestheaders.${k}`] = v;
              }
            }
            if (mw.config.customResponseHeaders) {
              for (const [k, v] of Object.entries(
                mw.config.customResponseHeaders as Record<string, string>
              )) {
                labels[`${prefix}.headers.customresponseheaders.${k}`] = v;
              }
            }
            break;
          case "rate-limit":
            if (typeof mw.config.average === "number") {
              labels[`${prefix}.ratelimit.average`] = String(mw.config.average);
            }
            if (typeof mw.config.burst === "number") {
              labels[`${prefix}.ratelimit.burst`] = String(mw.config.burst);
            }
            break;
          case "ip-whitelist":
            if (Array.isArray(mw.config.sourceRange)) {
              labels[`${prefix}.ipwhitelist.sourcerange`] = (
                mw.config.sourceRange as string[]
              ).join(",");
            }
            break;
        }
      }
      labels[`traefik.http.routers.${route.routerName}.middlewares`] = middlewareNames.join(",");
    }

    mergeLabels(service, labels);
  }
}
