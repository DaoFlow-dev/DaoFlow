import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Heart, RotateCcw, Save } from "lucide-react";
import type { ServiceRuntimeHealthCheck } from "./runtime-config";

interface HealthCheckCardProps {
  serviceId: string;
  healthcheckPath: string | null;
  port: string | null;
  healthCheck: ServiceRuntimeHealthCheck | null;
  onSaved: () => Promise<unknown>;
}

function buildDefaultCommand(healthcheckPath: string | null, port: string | null): string {
  return healthcheckPath ? `curl -f http://localhost:${port ?? "3000"}${healthcheckPath}` : "";
}

function parsePositiveInteger(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : null;
}

export function HealthCheckCard({
  serviceId,
  healthcheckPath,
  port,
  healthCheck,
  onSaved
}: HealthCheckCardProps) {
  const defaultCommand = buildDefaultCommand(healthcheckPath, port);
  const [command, setCommand] = useState(healthCheck?.command ?? defaultCommand);
  const [intervalSeconds, setIntervalSeconds] = useState(
    String(healthCheck?.intervalSeconds ?? 30)
  );
  const [timeoutSeconds, setTimeoutSeconds] = useState(String(healthCheck?.timeoutSeconds ?? 10));
  const [retries, setRetries] = useState(String(healthCheck?.retries ?? 3));
  const [startPeriodSeconds, setStartPeriodSeconds] = useState(
    String(healthCheck?.startPeriodSeconds ?? 15)
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();

  useEffect(() => {
    setCommand(healthCheck?.command ?? defaultCommand);
    setIntervalSeconds(String(healthCheck?.intervalSeconds ?? 30));
    setTimeoutSeconds(String(healthCheck?.timeoutSeconds ?? 10));
    setRetries(String(healthCheck?.retries ?? 3));
    setStartPeriodSeconds(String(healthCheck?.startPeriodSeconds ?? 15));
  }, [defaultCommand, healthCheck]);

  const isDirty =
    command !== (healthCheck?.command ?? defaultCommand) ||
    intervalSeconds !== String(healthCheck?.intervalSeconds ?? 30) ||
    timeoutSeconds !== String(healthCheck?.timeoutSeconds ?? 10) ||
    retries !== String(healthCheck?.retries ?? 3) ||
    startPeriodSeconds !== String(healthCheck?.startPeriodSeconds ?? 15);

  async function handleSave() {
    setFeedback(null);

    const parsedIntervalSeconds = parsePositiveInteger(intervalSeconds);
    const parsedTimeoutSeconds = parsePositiveInteger(timeoutSeconds);
    const parsedRetries = parsePositiveInteger(retries);
    const parsedStartPeriodSeconds = parsePositiveInteger(startPeriodSeconds);

    if (
      !command.trim() ||
      parsedIntervalSeconds === null ||
      parsedTimeoutSeconds === null ||
      parsedRetries === null ||
      parsedStartPeriodSeconds === null
    ) {
      setFeedback("Health-check overrides require a command and positive timing values.");
      return;
    }

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        healthCheck: {
          command: command.trim(),
          intervalSeconds: parsedIntervalSeconds,
          timeoutSeconds: parsedTimeoutSeconds,
          retries: parsedRetries,
          startPeriodSeconds: parsedStartPeriodSeconds
        }
      });
      await onSaved();
      setFeedback("Saved health-check override.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save the health-check override."
      );
    }
  }

  function handleReset() {
    setCommand(healthCheck?.command ?? defaultCommand);
    setIntervalSeconds(String(healthCheck?.intervalSeconds ?? 30));
    setTimeoutSeconds(String(healthCheck?.timeoutSeconds ?? 10));
    setRetries(String(healthCheck?.retries ?? 3));
    setStartPeriodSeconds(String(healthCheck?.startPeriodSeconds ?? 15));
    setFeedback(null);
  }

  async function handleClearOverride() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        healthCheck: null
      });
      await onSaved();
      setFeedback("Cleared health-check override.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to clear the health-check override right now."
      );
    }
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Heart size={14} />
          Health-Check Override
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          This config writes a compose `healthcheck` override. Leave fields unchanged to inherit the
          source compose definition.
        </p>
        <div className="space-y-4">
          <div>
            <label className="text-xs text-muted-foreground block mb-1.5">Command</label>
            <Input
              value={command}
              onChange={(event) => setCommand(event.target.value)}
              className="h-8 text-sm font-mono"
              placeholder="curl -f http://localhost:3000/health"
              data-testid={`service-health-command-${serviceId}`}
            />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <MetricInput
              label="Interval (s)"
              value={intervalSeconds}
              onChange={setIntervalSeconds}
              testId={`service-health-interval-${serviceId}`}
            />
            <MetricInput
              label="Timeout (s)"
              value={timeoutSeconds}
              onChange={setTimeoutSeconds}
              testId={`service-health-timeout-${serviceId}`}
            />
            <MetricInput
              label="Retries"
              value={retries}
              onChange={setRetries}
              testId={`service-health-retries-${serviceId}`}
            />
            <MetricInput
              label="Start Period (s)"
              value={startPeriodSeconds}
              onChange={setStartPeriodSeconds}
              testId={`service-health-start-period-${serviceId}`}
            />
          </div>
        </div>
        {feedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-health-feedback-${serviceId}`}
          >
            {feedback}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={() => void handleClearOverride()}
            disabled={!healthCheck || updateRuntimeConfig.isPending}
            data-testid={`service-health-clear-${serviceId}`}
          >
            Clear Override
          </Button>
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-health-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-health-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {updateRuntimeConfig.isPending ? "Saving..." : "Save Override"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function MetricInput({
  label,
  value,
  onChange,
  testId
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-8 text-sm"
        type="number"
        min="1"
        data-testid={testId}
      />
    </div>
  );
}
