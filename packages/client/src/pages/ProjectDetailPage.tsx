import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Settings2, Copy, Check, Trash2 } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger
} from "@/components/ui/alert-dialog";
import AddServiceDialog from "../components/AddServiceDialog";
import { ProjectOverviewCards } from "@/components/project/ProjectOverviewCards";
import { ProjectServicesList } from "@/components/project/ProjectServicesList";
import { ProjectSettingsPanel } from "@/components/project/ProjectSettingsPanel";
import { ProjectGitCard } from "@/components/project/ProjectGitCard";
import { getInventoryTone } from "@/lib/tone-utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAddService, setShowAddService] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const project = trpc.projectDetails.useQuery({ projectId: id! }, { enabled: !!id });
  const services = trpc.projectServices.useQuery({ projectId: id! }, { enabled: !!id });
  const environments = trpc.projectEnvironments.useQuery({ projectId: id! }, { enabled: !!id });
  const deployments = trpc.recentDeployments.useQuery({ limit: 20 });

  if (project.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64 rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    );
  }

  if (!project.data) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        Project not found.
        <br />
        <Button variant="ghost" className="mt-4" onClick={() => void navigate("/projects")}>
          Back to Projects
        </Button>
      </div>
    );
  }

  const p = project.data;
  const config =
    p.config && typeof p.config === "object" ? (p.config as Record<string, unknown>) : {};
  const serviceList = (services.data ?? []) as {
    id: string;
    name: string;
    sourceType: string;
    imageReference: string | null;
    composeServiceName: string | null;
    dockerfilePath: string | null;
    status: string;
    environmentId: string | null;
  }[];
  const envList = (environments.data ?? []) as {
    id: string;
    name: string;
    slug: string;
    createdAt: string;
  }[];

  const filteredServices = activeEnv
    ? serviceList.filter((s) => s.environmentId === activeEnv)
    : serviceList;

  const healthyCount = serviceList.filter((s) => {
    const tone = getInventoryTone(s.status);
    return tone === "healthy" || tone === "running";
  }).length;
  const unhealthyCount = serviceList.filter((s) => getInventoryTone(s.status) === "failed").length;

  const projectDeployments = (deployments.data ?? []).filter((d: { serviceName: string }) =>
    serviceList.some((s) => s.name === d.serviceName)
  );
  const lastDeploy = projectDeployments[0] as
    | {
        createdAt: string;
        status: string;
        statusTone?: string;
        statusLabel?: string;
      }
    | undefined;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => void navigate("/projects")}>
            <ArrowLeft size={18} />
          </Button>
          <div>
            <h1 className="text-2xl font-semibold">{p.name}</h1>
            {typeof config.description === "string" && config.description && (
              <p className="text-muted-foreground text-sm">{config.description}</p>
            )}
          </div>
          <Button
            size="sm"
            variant="ghost"
            title="Copy Project ID"
            aria-label="Copy project ID"
            onClick={() => {
              void navigator.clipboard.writeText(p.id).then(() => {
                setCopiedId(true);
                setTimeout(() => setCopiedId(false), 2000);
              });
            }}
          >
            {copiedId ? <Check size={14} /> : <Copy size={14} />}
          </Button>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowSettings(!showSettings);
              setEditName(p.name);
              setEditDesc(typeof config.description === "string" ? config.description : "");
            }}
          >
            <Settings2 size={14} className="mr-1" />
            Settings
          </Button>
          <Button size="sm" variant="outline" title="Duplicate Project">
            <Copy size={14} className="mr-1" />
            Duplicate
          </Button>
          <Button size="sm" onClick={() => setShowAddService(true)}>
            <Plus size={14} className="mr-1" />
            Add Service
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button size="sm" variant="destructive" aria-label="Delete project">
                <Trash2 size={14} className="mr-1" />
                Delete
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Delete project "{p.name}"?</AlertDialogTitle>
                <AlertDialogDescription>
                  This will permanently delete the project and all its services, environments, and
                  deployment history. This action cannot be undone.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancel</AlertDialogCancel>
                <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
                  Delete Project
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {showSettings && (
        <ProjectSettingsPanel
          editName={editName}
          onEditName={setEditName}
          editDesc={editDesc}
          onEditDesc={setEditDesc}
        />
      )}

      <ProjectGitCard config={config} />

      <ProjectOverviewCards
        serviceCount={serviceList.length}
        healthyCount={healthyCount}
        unhealthyCount={unhealthyCount}
        envCount={envList.length}
        lastDeploy={lastDeploy}
      />

      {/* Environment switcher */}
      {envList.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">Environment:</span>
          <Tabs
            value={activeEnv ?? "all"}
            onValueChange={(v) => setActiveEnv(v === "all" ? null : v)}
          >
            <TabsList className="h-8">
              <TabsTrigger value="all" className="text-xs px-3 h-6">
                All
              </TabsTrigger>
              {envList.map((env) => (
                <TabsTrigger key={env.id} value={env.id} className="text-xs px-3 h-6">
                  {env.name}
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
        </div>
      )}

      <ProjectServicesList
        services={filteredServices}
        isLoading={services.isLoading}
        activeEnv={activeEnv}
        activeEnvName={envList.find((e) => e.id === activeEnv)?.name}
      />

      {id && (
        <AddServiceDialog
          open={showAddService}
          onOpenChange={setShowAddService}
          projectId={id}
          environments={p.environments ?? []}
          onCreated={() => void services.refetch()}
        />
      )}
    </div>
  );
}
