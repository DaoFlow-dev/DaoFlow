import { useCallback, useEffect, useRef, useState } from "react";
import { getManagedDatabaseDefinition, type ManagedDatabaseKind } from "@daoflow/shared";
import { trpc } from "../lib/trpc";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogFooter
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ManagedDatabaseFields } from "./ManagedDatabaseFields";
import { ServiceSourceFields, type ServiceSourceType } from "./ServiceSourceFields";

type Environment = { id: string; name: string; targetServerId?: string | null };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  environments: Environment[];
  initialEnvironmentId?: string;
  onCreated: () => void;
}

type CreationMode = "service" | "database";

export default function AddServiceDialog({
  open,
  onOpenChange,
  projectId,
  environments,
  initialEnvironmentId,
  onCreated
}: Props) {
  const resolveInitialEnvironmentId = useCallback(
    () =>
      (initialEnvironmentId &&
      environments.some((environment) => environment.id === initialEnvironmentId)
        ? initialEnvironmentId
        : environments[0]?.id) ?? "",
    [environments, initialEnvironmentId]
  );
  const [name, setName] = useState("");
  const [creationMode, setCreationMode] = useState<CreationMode>("service");
  const [sourceType, setSourceType] = useState<ServiceSourceType>("compose");
  const [environmentId, setEnvironmentId] = useState(resolveInitialEnvironmentId);
  const [imageReference, setImageReference] = useState("");
  const [dockerfilePath, setDockerfilePath] = useState("");
  const [composeServiceName, setComposeServiceName] = useState("");
  const [databaseKind, setDatabaseKind] = useState<ManagedDatabaseKind>("postgres");
  const [databaseName, setDatabaseName] = useState("app");
  const [databaseUsername, setDatabaseUsername] = useState("app");
  const [databasePassword, setDatabasePassword] = useState("");
  const [databasePort, setDatabasePort] = useState("5432");
  const wasOpenRef = useRef(open);
  const selectedEnvironment = environments.find((environment) => environment.id === environmentId);

  const createService = trpc.createService.useMutation({
    onSuccess: () => {
      onCreated();
      handleOpenChange(false);
    }
  });
  const createManagedDatabase = trpc.createManagedDatabase.useMutation({
    onSuccess: () => {
      onCreated();
      handleOpenChange(false);
    }
  });

  function resetForm() {
    setName("");
    setCreationMode("service");
    setSourceType("compose");
    setEnvironmentId(resolveInitialEnvironmentId());
    setImageReference("");
    setDockerfilePath("");
    setComposeServiceName("");
    setDatabaseKind("postgres");
    setDatabaseName("app");
    setDatabaseUsername("app");
    setDatabasePassword("");
    setDatabasePort("5432");
  }

  function handleDatabaseKindChange(kind: ManagedDatabaseKind) {
    const definition = getManagedDatabaseDefinition(kind);
    setDatabaseKind(kind);
    setName(definition?.serviceName ?? kind);
    setDatabaseName(definition?.defaultDatabaseName ?? "");
    setDatabaseUsername(definition?.defaultUsername ?? "");
    setDatabasePassword("");
    setDatabasePort(definition?.defaultPort ?? "");
  }

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      resetForm();
    } else {
      setEnvironmentId(resolveInitialEnvironmentId());
    }

    onOpenChange(nextOpen);
  }

  useEffect(() => {
    if (!open) {
      wasOpenRef.current = false;
      return;
    }

    if (!wasOpenRef.current) {
      setEnvironmentId(resolveInitialEnvironmentId());
      wasOpenRef.current = true;
    }
  }, [open, resolveInitialEnvironmentId]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !environmentId) return;

    if (creationMode === "database") {
      if (!selectedEnvironment?.targetServerId) return;
      createManagedDatabase.mutate({
        kind: databaseKind,
        projectId,
        environmentName: selectedEnvironment.name,
        serverId: selectedEnvironment.targetServerId,
        name: name.trim(),
        ...(databaseName.trim() ? { databaseName: databaseName.trim() } : {}),
        ...(databaseUsername.trim() ? { username: databaseUsername.trim() } : {}),
        ...(databasePassword.trim() ? { password: databasePassword.trim() } : {}),
        ...(databasePort.trim() ? { port: databasePort.trim() } : {})
      });
      return;
    }

    createService.mutate({
      name: name.trim(),
      environmentId,
      projectId,
      sourceType,
      ...(sourceType === "image" && imageReference ? { imageReference } : {}),
      ...(sourceType === "dockerfile" && dockerfilePath ? { dockerfilePath } : {}),
      ...(sourceType === "compose" && composeServiceName ? { composeServiceName } : {})
    });
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add Service</DialogTitle>
          <DialogDescription>
            Create the first service for this project and keep the selected environment in place.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label htmlFor="svc-name">Name</Label>
            <Input
              id="svc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. api, web, worker"
              required
            />
          </div>

          <div>
            <Label>Kind</Label>
            <div className="flex gap-2 mt-1">
              <Button
                type="button"
                variant={creationMode === "service" ? "default" : "outline"}
                size="sm"
                onClick={() => setCreationMode("service")}
                data-testid="add-service-mode-service"
              >
                Service
              </Button>
              <Button
                type="button"
                variant={creationMode === "database" ? "default" : "outline"}
                size="sm"
                onClick={() => {
                  setCreationMode("database");
                  handleDatabaseKindChange(databaseKind);
                }}
                data-testid="add-service-mode-database"
              >
                Database
              </Button>
            </div>
          </div>

          <div>
            <Label htmlFor="svc-env">Environment</Label>
            <select
              id="svc-env"
              className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              value={environmentId}
              onChange={(e) => setEnvironmentId(e.target.value)}
              data-testid="add-service-environment-select"
            >
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
          </div>

          {creationMode === "database" && !selectedEnvironment?.targetServerId ? (
            <p className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
              Select an environment with a target server before creating a managed database.
            </p>
          ) : null}

          {creationMode === "service" ? (
            <ServiceSourceFields
              sourceType={sourceType}
              imageReference={imageReference}
              dockerfilePath={dockerfilePath}
              composeServiceName={composeServiceName}
              onSourceTypeChange={setSourceType}
              onImageReferenceChange={setImageReference}
              onDockerfilePathChange={setDockerfilePath}
              onComposeServiceNameChange={setComposeServiceName}
            />
          ) : null}

          {creationMode === "database" ? (
            <ManagedDatabaseFields
              kind={databaseKind}
              databaseName={databaseName}
              username={databaseUsername}
              password={databasePassword}
              port={databasePort}
              onKindChange={handleDatabaseKindChange}
              onDatabaseNameChange={setDatabaseName}
              onUsernameChange={setDatabaseUsername}
              onPasswordChange={setDatabasePassword}
              onPortChange={setDatabasePort}
            />
          ) : null}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={
                createService.isPending ||
                createManagedDatabase.isPending ||
                !name.trim() ||
                (creationMode === "database" && !selectedEnvironment?.targetServerId)
              }
              data-testid="add-service-submit"
            >
              {createService.isPending || createManagedDatabase.isPending
                ? "Creating…"
                : creationMode === "database"
                  ? "Create Database"
                  : "Create Service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
