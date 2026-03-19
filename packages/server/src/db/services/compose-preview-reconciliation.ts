import { and, eq, inArray } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { projects } from "../schema/projects";
import { tunnelRoutes, tunnels } from "../schema/tunnels";
import { triggerDeploy } from "./trigger-deploy";
import { loadComposePreviewHistory, type ComposePreviewHistoryRecord } from "./compose-previews";

type DomainStatus = "matched" | "missing" | "inactive" | "orphaned" | "cleared" | "unmanaged";
type ReconciliationStatus = "in-sync" | "drifted" | "stale" | "unmanaged";

export interface ComposePreviewReconciliationRecord extends Omit<
  ComposePreviewHistoryRecord,
  "latestDeployment"
> {
  desiredDomain: string | null;
  domainStatus: DomainStatus;
  reconciliationStatus: ReconciliationStatus;
  staleAt: string | null;
  isStale: boolean;
  staleReason: string | null;
  gcEligible: boolean;
  observedRoute: {
    hostname: string;
    service: string;
    path: string | null;
    status: string;
    tunnelId: string;
    tunnelName: string;
  } | null;
}

function evaluatePreviewStaleness(input: {
  preview: ComposePreviewHistoryRecord;
  staleAfterHours: number | null;
  now: Date;
}) {
  if (
    !input.staleAfterHours ||
    input.preview.latestAction !== "deploy" ||
    (input.preview.latestStatus !== "healthy" && input.preview.latestStatus !== "failed")
  ) {
    return {
      staleAt: null,
      isStale: false,
      staleReason: null,
      gcEligible: false
    };
  }

  const staleAt = new Date(
    new Date(input.preview.lastRequestedAt).getTime() + input.staleAfterHours * 60 * 60 * 1000
  );
  const isStale = input.now.getTime() >= staleAt.getTime();

  return {
    staleAt: staleAt.toISOString(),
    isStale,
    staleReason: isStale ? "retention-window-expired" : null,
    gcEligible: isStale
  };
}

function summarizeReconciliationStatus(input: {
  desiredDomain: string | null;
  domainStatus: DomainStatus;
  isStale: boolean;
}) {
  if (!input.desiredDomain) {
    return "unmanaged" as const;
  }
  if (input.isStale) {
    return "stale" as const;
  }
  if (
    input.domainStatus === "missing" ||
    input.domainStatus === "inactive" ||
    input.domainStatus === "orphaned"
  ) {
    return "drifted" as const;
  }
  return "in-sync" as const;
}

export async function listComposePreviewReconciliation(input: {
  serviceRef: string;
  requestedByUserId: string;
  now?: Date;
}) {
  const history = await loadComposePreviewHistory(input);
  const now = input.now ?? new Date();
  const staleAfterHours = history.service.previewConfig?.staleAfterHours ?? null;

  const [project] = await db
    .select({ id: projects.id, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, history.service.projectId))
    .limit(1);
  if (!project) {
    throw new Error("Project not found for compose preview reconciliation.");
  }

  const desiredDomains = [
    ...new Set(
      history.previews
        .map((preview) => preview.primaryDomain)
        .filter((domain): domain is string => typeof domain === "string" && domain.length > 0)
    )
  ];

  const routeRows =
    desiredDomains.length === 0
      ? []
      : await db
          .select({
            hostname: tunnelRoutes.hostname,
            service: tunnelRoutes.service,
            path: tunnelRoutes.path,
            status: tunnelRoutes.status,
            tunnelId: tunnelRoutes.tunnelId,
            tunnelName: tunnels.name
          })
          .from(tunnelRoutes)
          .innerJoin(tunnels, eq(tunnels.id, tunnelRoutes.tunnelId))
          .where(
            and(eq(tunnels.teamId, project.teamId), inArray(tunnelRoutes.hostname, desiredDomains))
          );

  const routeByHostname = new Map(routeRows.map((row) => [row.hostname, row]));

  const previews = history.previews.map((preview) => {
    const desiredDomain = preview.primaryDomain;
    const observedRoute = desiredDomain ? (routeByHostname.get(desiredDomain) ?? null) : null;
    const domainStatus: DomainStatus = !desiredDomain
      ? "unmanaged"
      : !observedRoute
        ? preview.isActive
          ? "missing"
          : "cleared"
        : observedRoute.status !== "active"
          ? "inactive"
          : preview.isActive
            ? "matched"
            : "orphaned";
    const staleness = evaluatePreviewStaleness({
      preview,
      staleAfterHours,
      now
    });

    return {
      ...preview,
      desiredDomain,
      domainStatus,
      reconciliationStatus: summarizeReconciliationStatus({
        desiredDomain,
        domainStatus,
        isStale: staleness.isStale
      }),
      observedRoute,
      ...staleness
    } satisfies ComposePreviewReconciliationRecord;
  });

  return {
    service: history.service,
    policy: {
      staleAfterHours
    },
    summary: {
      totalPreviews: previews.length,
      activePreviews: previews.filter((preview) => preview.isActive).length,
      inSync: previews.filter((preview) => preview.reconciliationStatus === "in-sync").length,
      drifted: previews.filter((preview) => preview.reconciliationStatus === "drifted").length,
      stale: previews.filter((preview) => preview.reconciliationStatus === "stale").length,
      unmanaged: previews.filter((preview) => preview.reconciliationStatus === "unmanaged").length,
      gcEligible: previews.filter((preview) => preview.gcEligible).length
    },
    previews
  };
}

export async function reconcileComposePreviewState(input: {
  serviceRef: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  dryRun?: boolean;
  limit?: number;
}) {
  const report = await listComposePreviewReconciliation({
    serviceRef: input.serviceRef,
    requestedByUserId: input.requestedByUserId
  });
  const dryRun = input.dryRun === true;
  const limit = input.limit ?? 20;
  const gcCandidates = report.previews
    .filter((preview) => preview.gcEligible)
    .sort((left, right) => left.lastRequestedAt.localeCompare(right.lastRequestedAt))
    .slice(0, limit);

  const queuedDeployments: { previewKey: string; deploymentId: string }[] = [];
  const failures: { previewKey: string; message: string }[] = [];

  if (!dryRun) {
    for (const preview of gcCandidates) {
      const result = await triggerDeploy({
        serviceId: report.service.id,
        preview: {
          target: preview.target,
          branch: preview.branch,
          pullRequestNumber: preview.pullRequestNumber ?? undefined,
          action: "destroy"
        },
        requestedByUserId: input.requestedByUserId,
        requestedByEmail: input.requestedByEmail,
        requestedByRole: input.requestedByRole
      });

      if (result.status === "ok" && result.deployment) {
        queuedDeployments.push({
          previewKey: preview.key,
          deploymentId: result.deployment.id
        });
        continue;
      }

      failures.push({
        previewKey: preview.key,
        message: result.message ?? `Failed to queue preview cleanup (${result.status}).`
      });
    }
  }

  const summaryText =
    dryRun === true
      ? `Evaluated ${report.previews.length} previews; ${gcCandidates.length} stale previews are eligible for cleanup.`
      : `Evaluated ${report.previews.length} previews; queued cleanup for ${queuedDeployments.length} stale previews and saw ${failures.length} failures.`;

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${report.service.id}`,
    action: dryRun ? "preview.reconcile.dry_run" : "preview.reconcile.run",
    inputSummary: summaryText,
    permissionScope: "deploy:start",
    outcome: failures.length > 0 ? "partial" : "success",
    metadata: {
      previewKeys: report.previews.map((preview) => ({
        key: preview.key,
        reconciliationStatus: preview.reconciliationStatus,
        domainStatus: preview.domainStatus,
        gcEligible: preview.gcEligible
      })),
      dryRun,
      queuedDeployments,
      failures
    }
  });

  await db.insert(events).values({
    kind: dryRun ? "preview.reconciliation.evaluated" : "preview.reconciliation.executed",
    resourceType: "service",
    resourceId: report.service.id,
    summary: summaryText,
    detail:
      dryRun === true
        ? "Preview reconciliation evaluated desired domains, observed tunnel routes, and stale preview eligibility."
        : "Preview reconciliation evaluated desired domains, observed tunnel routes, and queued stale preview cleanup deployments when eligible.",
    severity: failures.length > 0 ? "warning" : "info",
    metadata: {
      serviceName: report.service.name,
      policy: report.policy,
      previews: report.previews.map((preview) => ({
        key: preview.key,
        reconciliationStatus: preview.reconciliationStatus,
        domainStatus: preview.domainStatus,
        staleAt: preview.staleAt,
        gcEligible: preview.gcEligible
      })),
      queuedDeployments,
      failures,
      dryRun
    },
    createdAt: new Date()
  });

  return {
    ...report,
    execution: {
      dryRun,
      limit,
      gcCandidates: gcCandidates.length,
      gcQueued: queuedDeployments.length,
      queuedDeployments,
      failures
    }
  };
}
