import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowLeft, Plus, Settings2, Copy, Check, Loader2, Trash2 } from "lucide-react";
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
import { ProjectEnvironmentsPanel } from "@/components/project/ProjectEnvironmentsPanel";
import { ProjectServicesList } from "@/components/project/ProjectServicesList";
import { ProjectSettingsPanel } from "@/components/project/ProjectSettingsPanel";
import { ProjectGitCard } from "@/components/project/ProjectGitCard";
import { getInventoryTone } from "@/lib/tone-utils";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const utils = trpc.useUtils();
  const [showAddService, setShowAddService] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [activeEnv, setActiveEnv] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  const project = trpc.projectDetails.useQuery({ projectId: id! }, { enabled: !!id });
  const services = trpc.projectServices.useQuery({ projectId: id! }, { enabled: !!id });
  const environments = trpc.projectEnvironments.useQuery({ projectId: id! }, { enabled: !!id });
  const infrastructure = trpc.infrastructureInventory.useQuery(undefined, { enabled: !!id });
  const deployments = trpc.recentDeployments.useQuery({ limit: 20 });
  const refreshProjectViews = async () => {
    await Promise.all([
      project.refetch(),
      services.refetch(),
      environments.refetch(),
      utils.projects.invalidate()
    ]);
  };
  const updateProject = trpc.updateProject.useMutation({
    onSuccess: async () => {
      await Promise.all([project.refetch(), utils.projects.invalidate()]);
      setShowSettings(false);
    }
  });
  const deleteProject = trpc.deleteProject.useMutation({
    onSuccess: async () => {
      await utils.projects.invalidate();
      setShowDeleteDialog(false);
      void navigate("/projects");
    }
  });
  const createEnvironment = trpc.createEnvironment.useMutation({
    onSuccess: async () => {
      await refreshProjectViews();
    }
  });
  const updateEnvironment = trpc.updateEnvironment.useMutation({
    onSuccess: async () => {
      await refreshProjectViews();
    }
  });
  const deleteEnvironment = trpc.deleteEnvironment.useMutation({
    onSuccess: async (_, variables) => {
      if (variables.environmentId === activeEnv) {
        setActiveEnv(null);
      }
      await refreshProjectViews();
    }
  });

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
  const projectDescription = typeof config.description === "string" ? config.description : "";
  const serviceList = (services.data ?? []) as {
    id: string;
    name: string;
    sourceType: string;
    imageReference: string | null;
    composeServiceName: string | null;
    dockerfilePath: string | null;
    status: string;
    statusTone?: string;
    statusLabel?: string;
    environmentId: string | null;
    runtimeSummary?: {
      statusTone: string;
      statusLabel: string;
      summary: string;
    };
    rolloutStrategy?: {
      label: string;
      downtimeRisk: string;
    };
    latestDeployment?: {
      targetServerName: string | null;
      imageTag: string | null;
    } | null;
  }[];
  const envList = (environments.data ?? []) as {
    id: string;
    name: string;
    slug: string;
    status: string;
    statusTone?: string;
    targetServerId?: string | null;
    composeFiles?: string[];
    composeProfiles?: string[];
    serviceCount?: number;
    createdAt: string;
  }[];
  const serverList = (
    (infrastructure.data?.servers ?? []) as {
      id: string;
      name: string;
      host?: string | null;
    }[]
  ).map((server) => ({
    id: server.id,
    name: server.name,
    host: server.host
  }));
  const environmentErrorMessage =
    createEnvironment.error?.message ??
    updateEnvironment.error?.message ??
    deleteEnvironment.error?.message ??
    null;

  const filteredServices = activeEnv
    ? serviceList.filter((s) => s.environmentId === activeEnv)
    : serviceList;

  const healthyCount = serviceList.filter((s) => {
    const tone = s.runtimeSummary?.statusTone ?? s.statusTone ?? getInventoryTone(s.status);
    return tone === "healthy" || tone === "running";
  }).length;
  const unhealthyCount = serviceList.filter((s) => {
    const tone = s.runtimeSummary?.statusTone ?? s.statusTone ?? getInventoryTone(s.status);
    return tone === "failed";
  }).length;

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
  const trimmedEditName = editName.trim();
  const normalizedEditDesc = editDesc.trim();
  const saveDisabled =
    !trimmedEditName ||
    updateProject.isPending ||
    deleteProject.isPending ||
    (trimmedEditName === p.name && normalizedEditDesc === projectDescription);

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
              updateProject.reset();
              setShowSettings(!showSettings);
              setEditName(p.name);
              setEditDesc(projectDescription);
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
          <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
            <AlertDialogTrigger asChild>
              <Button
                size="sm"
                variant="destructive"
                aria-label="Delete project"
                onClick={() => deleteProject.reset()}
                disabled={deleteProject.isPending}
                data-testid={`project-delete-trigger-${p.id}`}
              >
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
                <AlertDialogCancel disabled={deleteProject.isPending}>Cancel</AlertDialogCancel>
                <AlertDialogAction
                  className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  onClick={(event) => {
                    event.preventDefault();
                    if (deleteProject.isPending) {
                      return;
                    }
                    deleteProject.mutate({ projectId: p.id });
                  }}
                  disabled={deleteProject.isPending}
                  data-testid={`project-delete-confirm-${p.id}`}
                >
                  {deleteProject.isPending ? (
                    <>
                      <Loader2 size={14} className="mr-1 animate-spin" />
                      Deleting...
                    </>
                  ) : (
                    "Delete Project"
                  )}
                </AlertDialogAction>
              </AlertDialogFooter>
              {deleteProject.error && (
                <p className="text-sm text-destructive">{deleteProject.error.message}</p>
              )}
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
          onSave={() =>
            updateProject.mutate({
              projectId: p.id,
              name: trimmedEditName,
              description: normalizedEditDesc
            })
          }
          onRequestDelete={() => {
            deleteProject.reset();
            setShowDeleteDialog(true);
          }}
          isSaving={updateProject.isPending}
          isDeletePending={deleteProject.isPending}
          saveDisabled={saveDisabled}
          errorMessage={updateProject.error?.message}
        />
      )}

      <ProjectGitCard
        config={config}
        repoUrl={p.repoUrl}
        repoFullName={p.repoFullName}
        defaultBranch={p.defaultBranch}
        autoDeploy={p.autoDeploy}
      />

      <ProjectOverviewCards
        serviceCount={serviceList.length}
        healthyCount={healthyCount}
        unhealthyCount={unhealthyCount}
        envCount={envList.length}
        lastDeploy={lastDeploy}
      />

      <ProjectEnvironmentsPanel
        projectId={p.id}
        environments={envList}
        servers={serverList}
        createPending={createEnvironment.isPending}
        updatePending={updateEnvironment.isPending}
        deletePending={deleteEnvironment.isPending}
        errorMessage={environmentErrorMessage}
        onCreate={(input) => {
          createEnvironment.reset();
          updateEnvironment.reset();
          deleteEnvironment.reset();
          createEnvironment.mutate({
            projectId: input.projectId,
            name: input.name,
            targetServerId: input.targetServerId || undefined,
            composeFiles: input.composeFiles?.length ? input.composeFiles : undefined,
            composeProfiles: input.composeProfiles?.length ? input.composeProfiles : undefined
          });
        }}
        onUpdate={(input) => {
          createEnvironment.reset();
          updateEnvironment.reset();
          deleteEnvironment.reset();
          updateEnvironment.mutate({
            environmentId: input.environmentId,
            name: input.name,
            status: input.status,
            targetServerId: input.targetServerId,
            composeFiles: input.composeFiles,
            composeProfiles: input.composeProfiles
          });
        }}
        onDelete={(environmentId) => {
          createEnvironment.reset();
          updateEnvironment.reset();
          deleteEnvironment.reset();
          deleteEnvironment.mutate({ environmentId });
        }}
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
