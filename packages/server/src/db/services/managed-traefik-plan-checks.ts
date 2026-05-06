import type { servers } from "../schema/servers";
import type { ManagedTraefikRoutingPlan } from "../../managed-traefik";
import { makePlanCheck, type PlanCheck } from "./deployment-plan-checks";

export function buildManagedTraefikPlanChecks(input: {
  server: typeof servers.$inferSelect | null;
  plan: ManagedTraefikRoutingPlan | null;
}): PlanCheck[] {
  if (!input.plan) {
    return [];
  }

  const checks: PlanCheck[] = [];
  if (!input.server) {
    checks.push(makePlanCheck("fail", "Managed Traefik routing needs a target server."));
  } else if (input.server.kind !== "docker-engine") {
    checks.push(
      makePlanCheck(
        "fail",
        "Managed Traefik routing is currently supported for Docker Compose host targets only."
      )
    );
  } else if (input.plan.routes.length > 0) {
    checks.push(
      makePlanCheck(
        "ok",
        `Managed Traefik will attach ${input.plan.routes.length} route${input.plan.routes.length === 1 ? "" : "s"} to network ${input.plan.proxy.networkName}.`
      )
    );
  }

  for (const route of input.plan.routes) {
    checks.push(
      makePlanCheck(
        "ok",
        `Traefik route ${route.hostname} -> ${route.targetServiceName}:${route.targetPort} will use ${route.entrypoint} with resolver ${route.certificateResolver}.`
      )
    );
  }

  for (const unresolved of input.plan.unresolvedDomains) {
    checks.push(
      makePlanCheck("fail", `Managed Traefik route ${unresolved.hostname}: ${unresolved.reason}`)
    );
  }

  const dnsTarget = input.plan.proxy.dnsTarget ?? input.server?.host ?? null;
  if (dnsTarget && input.plan.routes.length > 0) {
    checks.push(
      makePlanCheck(
        "ok",
        `DNS for managed hostnames should resolve to ${dnsTarget} before certificate issuance.`
      )
    );
  }

  return checks;
}
