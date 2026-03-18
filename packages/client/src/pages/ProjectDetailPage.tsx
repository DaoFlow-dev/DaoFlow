import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  ArrowLeft,
  Plus,
  Box,
  Layers,
  Settings2,
  Copy,
  Trash2,
  CheckCircle,
  AlertCircle,
  Clock,
  Save
} from "lucide-react";
import AddServiceDialog from "../components/AddServiceDialog";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAddService, setShowAddService] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");
  const [activeEnv, setActiveEnv] = useState<string | null>(null);

  const project = trpc.projectDetails.useQuery({ projectId: id! }, { enabled: !!id });
  const services = trpc.projectServices.useQuery({ projectId: id! }, { enabled: !!id });
  const environments = trpc.projectEnvironments.useQuery({ projectId: id! }, { enabled: !!id });
  const deployments = trpc.recentDeployments.useQuery({ limit: 20 });

  if (project.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
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

  // Filter services by active environment
  const filteredServices = activeEnv
    ? serviceList.filter((s) => s.environmentId === activeEnv)
    : serviceList;

  // Counts
  const healthyCount = serviceList.filter(
    (s) => s.status === "active" || s.status === "healthy"
  ).length;
  const unhealthyCount = serviceList.filter(
    (s) => s.status === "failed" || s.status === "error"
  ).length;

  // Last deployment from this project's services
  const projectDeployments = (deployments.data ?? []).filter((d: { serviceName: string }) =>
    serviceList.some((s) => s.name === d.serviceName)
  );
  const lastDeploy = projectDeployments[0] as { createdAt: string; status: string } | undefined;

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
        </div>
      </div>

      {/* Settings panel (item 47) */}
      {showSettings && (
        <Card className="border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Settings2 size={14} />
              Project Settings
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Project Name</label>
              <Input
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="h-8 text-sm max-w-sm"
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Description</label>
              <Input
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                className="h-8 text-sm max-w-lg"
                placeholder="Optional project description"
              />
            </div>
            <div className="flex items-center gap-2">
              <Button size="sm">
                <Save size={14} className="mr-1" />
                Save
              </Button>
              <Button
                size="sm"
                variant="destructive"
                title="Delete project — this cannot be undone"
              >
                <Trash2 size={14} className="mr-1" />
                Delete Project
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Overview dashboard (item 45) */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Box size={14} />
              Services
            </div>
            <span className="text-2xl font-bold">{serviceList.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <CheckCircle size={14} className="text-green-500" />
              Healthy
            </div>
            <span className="text-2xl font-bold text-green-500">{healthyCount}</span>
            {unhealthyCount > 0 && (
              <span className="ml-2 text-sm text-red-400">
                <AlertCircle size={12} className="inline mr-0.5" />
                {unhealthyCount} unhealthy
              </span>
            )}
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Layers size={14} />
              Environments
            </div>
            <span className="text-2xl font-bold">{envList.length}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-6">
            <div className="flex items-center gap-2 text-sm text-muted-foreground mb-1">
              <Clock size={14} />
              Last Deploy
            </div>
            {lastDeploy ? (
              <div>
                <span className="text-sm">
                  {new Date(lastDeploy.createdAt).toLocaleDateString()}
                </span>
                <Badge variant="secondary" className="ml-2 text-xs">
                  {lastDeploy.status}
                </Badge>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Never</span>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Environment switcher (item 46) */}
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

      {/* Services list */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">
          Services
          {activeEnv && (
            <span className="text-sm text-muted-foreground ml-2">
              ({envList.find((e) => e.id === activeEnv)?.name})
            </span>
          )}
        </h2>
      </div>

      {services.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : filteredServices.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {activeEnv
              ? "No services in this environment."
              : "No services yet. Add your first Docker or Compose service."}
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {filteredServices.map((svc) => (
            <Card
              key={svc.id}
              className="hover:border-primary/30 transition-colors cursor-pointer"
              onClick={() => void navigate(`/services/${svc.id}`)}
            >
              <CardContent className="py-4 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-2 h-2 rounded-full ${
                      svc.status === "active" || svc.status === "healthy"
                        ? "bg-green-500"
                        : svc.status === "failed"
                          ? "bg-red-500"
                          : "bg-gray-400"
                    }`}
                  />
                  <div>
                    <p className="font-medium">{svc.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {svc.sourceType} ·{" "}
                      {svc.imageReference || svc.composeServiceName || svc.dockerfilePath || "—"}
                    </p>
                  </div>
                </div>
                <Badge
                  variant={
                    svc.status === "active" || svc.status === "healthy"
                      ? "default"
                      : svc.status === "failed"
                        ? "destructive"
                        : "secondary"
                  }
                >
                  {svc.status}
                </Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Service Dialog */}
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
