import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { trpc } from "../lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft, Plus, Box, Layers, Server } from "lucide-react";
import AddServiceDialog from "../components/AddServiceDialog";

export default function ProjectDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [showAddService, setShowAddService] = useState(false);

  const project = trpc.projectDetails.useQuery({ projectId: id! }, { enabled: !!id });
  const services = trpc.projectServices.useQuery({ projectId: id! }, { enabled: !!id });

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
        <Button
          variant="ghost"
          className="mt-4"
          onClick={() => {
            void navigate("/projects");
          }}
        >
          Back to Projects
        </Button>
      </div>
    );
  }

  const p = project.data;
  const config =
    p.config && typeof p.config === "object" ? (p.config as Record<string, unknown>) : {};

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => {
            void navigate("/projects");
          }}
        >
          <ArrowLeft size={18} />
        </Button>
        <div>
          <h1 className="text-2xl font-semibold">{p.name}</h1>
          {typeof config.description === "string" && config.description && (
            <p className="text-muted-foreground text-sm">{config.description}</p>
          )}
        </div>
      </div>

      {/* Project info cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Layers size={14} /> Environments
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{p.environments?.length ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Box size={14} /> Services
            </CardTitle>
          </CardHeader>
          <CardContent>
            <span className="text-2xl font-bold">{services.data?.length ?? 0}</span>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm flex items-center gap-2">
              <Server size={14} /> Source
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Badge variant="secondary">{p.sourceType ?? "compose"}</Badge>
          </CardContent>
        </Card>
      </div>

      {/* Services list */}
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-medium">Services</h2>
        <Button size="sm" onClick={() => setShowAddService(true)}>
          <Plus size={14} className="mr-1" /> Add Service
        </Button>
      </div>

      {services.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : services.data?.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            No services yet. Add your first Docker or Compose service.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {services.data?.map(
            (svc: {
              id: string;
              name: string;
              sourceType: string;
              imageReference: string | null;
              composeServiceName: string | null;
              dockerfilePath: string | null;
              status: string;
            }) => (
              <Card
                key={svc.id}
                className="hover:border-primary/30 transition-colors cursor-pointer"
                onClick={() => {
                  void navigate(`/services/${svc.id}`);
                }}
              >
                <CardContent className="py-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <Box size={18} className="text-muted-foreground" />
                    <div>
                      <p className="font-medium">{svc.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {svc.sourceType} &middot;{" "}
                        {svc.imageReference || svc.composeServiceName || svc.dockerfilePath || "—"}
                      </p>
                    </div>
                  </div>
                  <Badge variant={svc.status === "active" ? "default" : "secondary"}>
                    {svc.status}
                  </Badge>
                </CardContent>
              </Card>
            )
          )}
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
