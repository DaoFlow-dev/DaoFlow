import { useCallback, useEffect, useRef, useState } from "react";
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

type Environment = { id: string; name: string };

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  environments: Environment[];
  initialEnvironmentId?: string;
  onCreated: () => void;
}

const sourceTypes = ["compose", "dockerfile", "image"] as const;

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
  const [sourceType, setSourceType] = useState<(typeof sourceTypes)[number]>("compose");
  const [environmentId, setEnvironmentId] = useState(resolveInitialEnvironmentId);
  const [imageReference, setImageReference] = useState("");
  const [dockerfilePath, setDockerfilePath] = useState("");
  const [composeServiceName, setComposeServiceName] = useState("");
  const wasOpenRef = useRef(open);

  const createService = trpc.createService.useMutation({
    onSuccess: () => {
      onCreated();
      handleOpenChange(false);
    }
  });

  function resetForm() {
    setName("");
    setSourceType("compose");
    setEnvironmentId(resolveInitialEnvironmentId());
    setImageReference("");
    setDockerfilePath("");
    setComposeServiceName("");
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

          <div>
            <Label>Source Type</Label>
            <div className="flex gap-2 mt-1">
              {sourceTypes.map((st) => (
                <Button
                  key={st}
                  type="button"
                  variant={sourceType === st ? "default" : "outline"}
                  size="sm"
                  onClick={() => setSourceType(st)}
                >
                  {st}
                </Button>
              ))}
            </div>
          </div>

          {sourceType === "image" && (
            <div>
              <Label htmlFor="svc-image">Image Reference</Label>
              <Input
                id="svc-image"
                value={imageReference}
                onChange={(e) => setImageReference(e.target.value)}
                placeholder="e.g. nginx:latest"
              />
            </div>
          )}

          {sourceType === "dockerfile" && (
            <div>
              <Label htmlFor="svc-dockerfile">Dockerfile Path</Label>
              <Input
                id="svc-dockerfile"
                value={dockerfilePath}
                onChange={(e) => setDockerfilePath(e.target.value)}
                placeholder="e.g. ./Dockerfile"
              />
            </div>
          )}

          {sourceType === "compose" && (
            <div>
              <Label htmlFor="svc-compose">Compose Service Name</Label>
              <Input
                id="svc-compose"
                value={composeServiceName}
                onChange={(e) => setComposeServiceName(e.target.value)}
                placeholder="e.g. web, db, redis"
              />
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => handleOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={createService.isPending || !name.trim()}>
              {createService.isPending ? "Creating…" : "Create Service"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
