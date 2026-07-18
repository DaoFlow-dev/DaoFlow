import { useEffect, useState } from "react";
import type { FormEvent } from "react";
import { Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { trpc } from "@/lib/trpc";

const BUILD_SLOTS_MIN = 1;
const BUILD_SLOTS_MAX = 20;
const QUEUED_DEPLOYMENTS_MIN = 1;
const QUEUED_DEPLOYMENTS_MAX = 500;

interface ServerCapacityPanelProps {
  serverId: string;
  maxConcurrentBuilds: number;
  maxQueuedDeployments: number;
  canManage: boolean;
  onSaved: () => Promise<void>;
}

type Feedback = {
  message: string;
  tone: "error" | "success";
};

function toFieldValue(value: number) {
  return String(value);
}

function parseCapacityValue(value: string, label: string, min: number, max: number) {
  if (!value.trim()) {
    throw new Error(`${label} is required.`);
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be a whole number from ${min} to ${max}.`);
  }

  return parsed;
}

export function ServerCapacityPanel({
  serverId,
  maxConcurrentBuilds,
  maxQueuedDeployments,
  canManage,
  onSaved
}: ServerCapacityPanelProps) {
  const [buildSlots, setBuildSlots] = useState(toFieldValue(maxConcurrentBuilds));
  const [queuedDeployments, setQueuedDeployments] = useState(toFieldValue(maxQueuedDeployments));
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const configureServerCapacity = trpc.configureServerCapacity.useMutation();

  useEffect(() => {
    setBuildSlots(toFieldValue(maxConcurrentBuilds));
    setQueuedDeployments(toFieldValue(maxQueuedDeployments));
  }, [maxConcurrentBuilds, maxQueuedDeployments]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFeedback(null);

    if (!canManage) {
      return;
    }

    try {
      const nextBuildSlots = parseCapacityValue(
        buildSlots,
        "Maximum concurrent builds",
        BUILD_SLOTS_MIN,
        BUILD_SLOTS_MAX
      );
      const nextQueuedDeployments = parseCapacityValue(
        queuedDeployments,
        "Maximum queued deployments",
        QUEUED_DEPLOYMENTS_MIN,
        QUEUED_DEPLOYMENTS_MAX
      );

      await configureServerCapacity.mutateAsync({
        serverId,
        maxConcurrentBuilds: nextBuildSlots,
        maxQueuedDeployments: nextQueuedDeployments
      });
      await onSaved();
      setFeedback({ message: "Server capacity saved.", tone: "success" });
    } catch (error) {
      setFeedback({
        message: error instanceof Error ? error.message : "Unable to save server capacity.",
        tone: "error"
      });
    }
  }

  return (
    <Card data-testid={`server-capacity-panel-${serverId}`}>
      <CardHeader>
        <CardTitle className="text-base" data-testid={`server-capacity-title-${serverId}`}>
          Build and deployment capacity
        </CardTitle>
        <CardDescription data-testid={`server-capacity-description-${serverId}`}>
          Set how many image builds can run at once and how many deployments can wait in the queue.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form className="space-y-5" onSubmit={(event) => void handleSubmit(event)}>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor={`server-capacity-builds-${serverId}`}>
                Maximum concurrent builds
              </Label>
              <Input
                id={`server-capacity-builds-${serverId}`}
                type="number"
                min={BUILD_SLOTS_MIN}
                max={BUILD_SLOTS_MAX}
                step={1}
                value={buildSlots}
                readOnly={!canManage}
                aria-readonly={!canManage}
                onChange={(event) => setBuildSlots(event.target.value)}
                data-testid={`server-capacity-builds-${serverId}`}
              />
              <p
                className="text-xs text-muted-foreground"
                data-testid={`server-capacity-builds-help-${serverId}`}
              >
                Whole numbers from 1 to 20. The default is 1.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor={`server-capacity-queued-${serverId}`}>
                Maximum queued deployments
              </Label>
              <Input
                id={`server-capacity-queued-${serverId}`}
                type="number"
                min={QUEUED_DEPLOYMENTS_MIN}
                max={QUEUED_DEPLOYMENTS_MAX}
                step={1}
                value={queuedDeployments}
                readOnly={!canManage}
                aria-readonly={!canManage}
                onChange={(event) => setQueuedDeployments(event.target.value)}
                data-testid={`server-capacity-queued-${serverId}`}
              />
              <p
                className="text-xs text-muted-foreground"
                data-testid={`server-capacity-queued-help-${serverId}`}
              >
                Whole numbers from 1 to 500. The default is 20.
              </p>
            </div>
          </div>

          <p
            className="rounded-md bg-muted p-3 text-sm text-muted-foreground"
            data-testid={`server-capacity-build-slot-explanation-${serverId}`}
          >
            Image-only and runtime-only deployments do not use build slots. Only deployments that
            build an image consume the concurrent build capacity.
          </p>

          {!canManage ? (
            <p
              className="text-sm text-muted-foreground"
              data-testid={`server-capacity-read-only-${serverId}`}
            >
              Only owners and admins can change capacity values.
            </p>
          ) : (
            <Button
              type="submit"
              disabled={configureServerCapacity.isPending}
              data-testid={`server-capacity-save-${serverId}`}
            >
              <Save size={14} className="mr-1" />
              {configureServerCapacity.isPending ? "Saving..." : "Save capacity"}
            </Button>
          )}

          {feedback ? (
            <p
              className={
                feedback.tone === "error"
                  ? "text-sm text-destructive"
                  : "text-sm text-emerald-700 dark:text-emerald-400"
              }
              role={feedback.tone === "error" ? "alert" : "status"}
              aria-live="polite"
              data-testid={`server-capacity-feedback-${serverId}`}
            >
              {feedback.message}
            </p>
          ) : null}
        </form>
      </CardContent>
    </Card>
  );
}
