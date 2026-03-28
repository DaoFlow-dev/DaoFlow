import { Suspense, lazy, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Settings2,
  Rocket,
  ScrollText,
  Terminal,
  BarChart3,
  Key,
  Globe,
  Wrench,
  Activity,
  FileCode
} from "lucide-react";

import ServiceHeader from "../components/service-detail/ServiceHeader";
import GeneralTab from "../components/service-detail/GeneralTab";
import DeploymentsTab from "../components/service-detail/DeploymentsTab";
import TerminalTab from "../components/service-detail/TerminalTab";
import EnvironmentTab from "../components/service-detail/EnvironmentTab";
import DomainsTab from "../components/service-detail/DomainsTab";
import AdvancedTab from "../components/service-detail/AdvancedTab";
import ActivityTab from "../components/service-detail/ActivityTab";
import TerminalAccessNotice from "../components/service-detail/TerminalAccessNotice";
import type { ServiceRuntimeConfig } from "../components/service-detail/runtime-config";
import type { ServiceEndpointSummary } from "@/components/service-detail/service-endpoint-types";
import { ServiceRecoveryPanel } from "@/components/service-detail/ServiceRecoveryPanel";
import type { PreviewLifecycleConfig } from "@/components/service-detail/PreviewLifecyclePanel";

const LogsTab = lazy(() => import("../components/service-detail/LogsTab"));
const MonitoringTab = lazy(() => import("../components/service-detail/MonitoringTab"));
const ComposeEditorTab = lazy(() => import("../components/service-detail/ComposeEditorTab"));

function LazyTabSkeleton({ testId }: { testId: string }) {
  return (
    <div className="space-y-3" data-testid={testId}>
      <Skeleton className="h-10 w-40 rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
      <Skeleton className="h-32 w-full rounded-xl" />
    </div>
  );
}

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const session = useSession();
  const [activeTab, setActiveTab] = useState("general");
  const viewer = trpc.viewer.useQuery(undefined, { enabled: Boolean(session.data) });

  const service = trpc.serviceDetails.useQuery(
    { serviceId: id! },
    {
      enabled: !!id,
      refetchInterval: 10000 // Auto-refresh status every 10s (item 3)
    }
  );

  if (service.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-12 w-64 rounded-xl" />
        <Skeleton className="h-10 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!service.data) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Service not found.
        <br />
        <Button variant="ghost" className="mt-4" onClick={() => void navigate("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const svc = service.data as {
    id: string;
    name: string;
    slug: string;
    sourceType: string;
    status: string;
    statusTone?: string;
    statusLabel?: string;
    projectId: string;
    projectName?: string | null;
    environmentId: string | null;
    environmentName?: string | null;
    imageReference: string | null;
    dockerfilePath: string | null;
    composeServiceName: string | null;
    port: string | null;
    healthcheckPath: string | null;
    replicaCount: string;
    targetServerId: string | null;
    createdAt: string;
    updatedAt: string;
    config?: {
      preview?: PreviewLifecycleConfig | null;
    } | null;
    runtimeConfig: ServiceRuntimeConfig | null;
    runtimeConfigPreview: string | null;
    runtimeSummary?: {
      statusLabel: string;
      statusTone: string;
      summary: string;
      observedAt: string | null;
    };
    endpointSummary?: ServiceEndpointSummary | null;
    rolloutStrategy?: {
      label: string;
      summary: string;
      downtimeRisk: string;
      supportsZeroDowntime: boolean;
    };
    latestDeployment?: {
      id: string;
      statusLabel: string;
      statusTone: string;
      summary: string;
      failureAnalysis?: string | null;
      targetServerName: string | null;
      targetServerHost?: string | null;
      imageTag: string | null;
      finishedAt: string | null;
    } | null;
  };
  const viewerCapabilities = viewer.data?.authz.capabilities ?? [];
  const canOpenTerminal = viewerCapabilities.includes("terminal:open");
  const canReadPreviews =
    viewerCapabilities.includes("deploy:read") || viewerCapabilities.includes("deploy:start");
  const canManagePreviews = viewerCapabilities.includes("deploy:start");
  const isCheckingTerminalAccess = Boolean(session.data) && viewer.isLoading && !viewer.data;

  return (
    <div className="space-y-6">
      {/* Header with breadcrumbs, status, and quick actions (items 1-4) */}
      <ServiceHeader
        service={svc}
        projectName={svc.projectName ?? undefined}
        environmentName={svc.environmentName ?? undefined}
      />

      <ServiceRecoveryPanel
        serviceName={svc.name}
        status={svc.status}
        statusTone={svc.statusTone}
        runtimeSummary={svc.runtimeSummary}
        latestDeployment={svc.latestDeployment}
        onOpenDeploy={() => void navigate(`/deploy?source=service&serviceId=${svc.id}`)}
        onOpenDeployments={() => setActiveTab("deployments")}
        onOpenLogs={() => setActiveTab("logs")}
      />

      {/* Tabbed interface (item 1) */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="w-full justify-start flex-wrap h-auto gap-1 bg-transparent p-0 border-b rounded-none pb-2 overflow-x-auto">
          <TabsTrigger value="general" className="gap-1.5 data-[state=active]:bg-muted">
            <Settings2 size={14} />
            General
          </TabsTrigger>
          <TabsTrigger value="deployments" className="gap-1.5 data-[state=active]:bg-muted">
            <Rocket size={14} />
            Deployments
          </TabsTrigger>
          <TabsTrigger value="logs" className="gap-1.5 data-[state=active]:bg-muted">
            <ScrollText size={14} />
            Logs
          </TabsTrigger>
          <TabsTrigger
            value="terminal"
            className="gap-1.5 data-[state=active]:bg-muted"
            data-testid="service-detail-terminal-trigger"
          >
            <Terminal size={14} />
            Terminal
            {!canOpenTerminal && !isCheckingTerminalAccess ? (
              <Badge
                variant="outline"
                className="ml-1 border-amber-500/50 text-[10px] uppercase tracking-wide text-amber-700 dark:text-amber-300"
                data-testid="service-detail-terminal-restricted-badge"
              >
                Restricted
              </Badge>
            ) : null}
          </TabsTrigger>
          <TabsTrigger value="monitoring" className="gap-1.5 data-[state=active]:bg-muted">
            <BarChart3 size={14} />
            Monitoring
          </TabsTrigger>
          <TabsTrigger value="environment" className="gap-1.5 data-[state=active]:bg-muted">
            <Key size={14} />
            Environment
          </TabsTrigger>
          <TabsTrigger value="domains" className="gap-1.5 data-[state=active]:bg-muted">
            <Globe size={14} />
            Domains
          </TabsTrigger>
          <TabsTrigger value="compose" className="gap-1.5 data-[state=active]:bg-muted">
            <FileCode size={14} />
            Compose
          </TabsTrigger>
          <TabsTrigger value="advanced" className="gap-1.5 data-[state=active]:bg-muted">
            <Wrench size={14} />
            Advanced
          </TabsTrigger>
          <TabsTrigger value="activity" className="gap-1.5 data-[state=active]:bg-muted">
            <Activity size={14} />
            Activity
          </TabsTrigger>
        </TabsList>

        <TabsContent value="general" className="mt-4">
          <GeneralTab
            service={svc}
            onOpenDeploy={() => void navigate(`/deploy?source=service&serviceId=${svc.id}`)}
            onOpenDeployments={() => setActiveTab("deployments")}
            onOpenLogs={() => setActiveTab("logs")}
          />
        </TabsContent>

        <TabsContent value="deployments" className="mt-4">
          <DeploymentsTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <Suspense fallback={<LazyTabSkeleton testId="service-detail-logs-loading" />}>
            <LogsTab serviceId={svc.id} serviceName={svc.name} />
          </Suspense>
        </TabsContent>

        <TabsContent value="terminal" className="mt-4">
          {canOpenTerminal ? (
            <TerminalTab serviceId={svc.id} />
          ) : (
            <TerminalAccessNotice
              serviceName={svc.name}
              isCheckingAccess={isCheckingTerminalAccess}
            />
          )}
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4">
          <Suspense fallback={<LazyTabSkeleton testId="service-detail-monitoring-loading" />}>
            <MonitoringTab serviceId={svc.id} serviceName={svc.name} />
          </Suspense>
        </TabsContent>

        <TabsContent value="environment" className="mt-4">
          <EnvironmentTab
            serviceId={svc.id}
            serviceName={svc.name}
            environmentId={svc.environmentId ?? undefined}
            sourceType={svc.sourceType}
            previewConfig={svc.config?.preview ?? null}
            canReadPreviews={canReadPreviews}
            canManagePreviews={canManagePreviews}
          />
        </TabsContent>

        <TabsContent value="domains" className="mt-4">
          <DomainsTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <Suspense fallback={<LazyTabSkeleton testId="service-detail-compose-loading" />}>
            <ComposeEditorTab
              serviceId={svc.id}
              serviceName={svc.name}
              sourceType={svc.sourceType}
              composeServiceName={svc.composeServiceName}
              runtimeConfigPreview={svc.runtimeConfigPreview}
            />
          </Suspense>
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          <AdvancedTab
            serviceId={svc.id}
            service={svc}
            runtimeConfig={svc.runtimeConfig}
            onConfigSaved={() => service.refetch()}
          />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab serviceId={svc.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
