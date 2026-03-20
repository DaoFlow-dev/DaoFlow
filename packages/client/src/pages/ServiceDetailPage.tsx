import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
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
import LogsTab from "../components/service-detail/LogsTab";
import TerminalTab from "../components/service-detail/TerminalTab";
import MonitoringTab from "../components/service-detail/MonitoringTab";
import EnvironmentTab from "../components/service-detail/EnvironmentTab";
import DomainsTab from "../components/service-detail/DomainsTab";
import AdvancedTab from "../components/service-detail/AdvancedTab";
import ActivityTab from "../components/service-detail/ActivityTab";
import ComposeEditorTab from "../components/service-detail/ComposeEditorTab";

export default function ServiceDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

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
    projectId: string;
    environmentId: string | null;
    imageReference: string | null;
    dockerfilePath: string | null;
    composeServiceName: string | null;
    port: string | null;
    healthcheckPath: string | null;
    replicaCount: string;
    targetServerId: string | null;
    createdAt: string;
    updatedAt: string;
  };

  return (
    <div className="space-y-6">
      {/* Header with breadcrumbs, status, and quick actions (items 1-4) */}
      <ServiceHeader service={svc} />

      {/* Tabbed interface (item 1) */}
      <Tabs defaultValue="general" className="w-full">
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
          <TabsTrigger value="terminal" className="gap-1.5 data-[state=active]:bg-muted">
            <Terminal size={14} />
            Terminal
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
          <GeneralTab service={svc} />
        </TabsContent>

        <TabsContent value="deployments" className="mt-4">
          <DeploymentsTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="logs" className="mt-4">
          <LogsTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="terminal" className="mt-4">
          <TerminalTab serviceId={svc.id} />
        </TabsContent>

        <TabsContent value="monitoring" className="mt-4">
          <MonitoringTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="environment" className="mt-4">
          <EnvironmentTab serviceId={svc.id} environmentId={svc.environmentId ?? undefined} />
        </TabsContent>

        <TabsContent value="domains" className="mt-4">
          <DomainsTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="compose" className="mt-4">
          <ComposeEditorTab serviceId={svc.id} serviceName={svc.name} />
        </TabsContent>

        <TabsContent value="advanced" className="mt-4">
          <AdvancedTab serviceId={svc.id} service={svc} />
        </TabsContent>

        <TabsContent value="activity" className="mt-4">
          <ActivityTab serviceId={svc.id} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
