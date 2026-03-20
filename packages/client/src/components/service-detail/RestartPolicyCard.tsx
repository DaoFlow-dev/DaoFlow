import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { trpc } from "@/lib/trpc";
import { RefreshCw, RotateCcw, Save } from "lucide-react";
import type { RuntimeRestartPolicyName, ServiceRuntimeRestartPolicy } from "./runtime-config";

interface RestartPolicyCardProps {
  serviceId: string;
  restartPolicy: ServiceRuntimeRestartPolicy | null;
  onSaved: () => Promise<unknown>;
}

const DEFAULT_POLICY: RuntimeRestartPolicyName = "unless-stopped";

export function RestartPolicyCard({ serviceId, restartPolicy, onSaved }: RestartPolicyCardProps) {
  const [policy, setPolicy] = useState<RuntimeRestartPolicyName>(
    restartPolicy?.name ?? DEFAULT_POLICY
  );
  const [maxRetries, setMaxRetries] = useState(
    restartPolicy?.maxRetries ? String(restartPolicy.maxRetries) : ""
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();

  useEffect(() => {
    setPolicy(restartPolicy?.name ?? DEFAULT_POLICY);
    setMaxRetries(restartPolicy?.maxRetries ? String(restartPolicy.maxRetries) : "");
  }, [restartPolicy]);

  const isDirty =
    policy !== (restartPolicy?.name ?? DEFAULT_POLICY) ||
    maxRetries !== (restartPolicy?.maxRetries ? String(restartPolicy.maxRetries) : "");

  async function handleSave() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        restartPolicy: {
          name: policy,
          maxRetries: policy === "on-failure" && maxRetries ? Number(maxRetries) : null
        }
      });
      await onSaved();
      setFeedback("Saved restart override.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save the restart override right now."
      );
    }
  }

  function handleReset() {
    setPolicy(restartPolicy?.name ?? DEFAULT_POLICY);
    setMaxRetries(restartPolicy?.maxRetries ? String(restartPolicy.maxRetries) : "");
    setFeedback(null);
  }

  async function handleClearOverride() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        restartPolicy: null
      });
      await onSaved();
      setFeedback("Cleared restart override.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to clear the restart override right now."
      );
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <RefreshCw size={14} />
          Restart Override
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Override the compose restart policy for this service. Clearing the override reverts to the
          upstream compose definition.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Policy</label>
            <Select
              value={policy}
              onValueChange={(value) => setPolicy(value as RuntimeRestartPolicyName)}
            >
              <SelectTrigger
                className="h-8 text-sm"
                data-testid={`service-restart-policy-${serviceId}`}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="always">Always</SelectItem>
                <SelectItem value="unless-stopped">Unless Stopped</SelectItem>
                <SelectItem value="on-failure">On Failure</SelectItem>
                <SelectItem value="no">Never</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {policy === "on-failure" ? (
            <div>
              <label className="text-xs text-muted-foreground block mb-1.5">Max Retries</label>
              <Input
                value={maxRetries}
                onChange={(event) => setMaxRetries(event.target.value)}
                className="h-8 text-sm"
                type="number"
                min="1"
                data-testid={`service-restart-retries-${serviceId}`}
              />
            </div>
          ) : null}
        </div>
        {feedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-restart-feedback-${serviceId}`}
          >
            {feedback}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleClearOverride()}
            disabled={!restartPolicy || updateRuntimeConfig.isPending}
            data-testid={`service-restart-clear-${serviceId}`}
          >
            Clear Override
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-restart-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-restart-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {updateRuntimeConfig.isPending ? "Saving..." : "Save Override"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
