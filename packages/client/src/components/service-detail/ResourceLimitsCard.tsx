import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { trpc } from "@/lib/trpc";
import { Cpu, RotateCcw, Save } from "lucide-react";
import type { ServiceRuntimeResources } from "./runtime-config";

interface ResourceLimitsCardProps {
  serviceId: string;
  resources: ServiceRuntimeResources | null;
  onSaved: () => Promise<unknown>;
}

function toFieldValue(value: number | null): string {
  return value === null ? "" : String(value);
}

function parseNumber(value: string): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function ResourceLimitsCard({ serviceId, resources, onSaved }: ResourceLimitsCardProps) {
  const [cpuLimit, setCpuLimit] = useState(toFieldValue(resources?.cpuLimitCores ?? null));
  const [cpuReservation, setCpuReservation] = useState(
    toFieldValue(resources?.cpuReservationCores ?? null)
  );
  const [memoryLimit, setMemoryLimit] = useState(toFieldValue(resources?.memoryLimitMb ?? null));
  const [memoryReservation, setMemoryReservation] = useState(
    toFieldValue(resources?.memoryReservationMb ?? null)
  );
  const [feedback, setFeedback] = useState<string | null>(null);
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();

  useEffect(() => {
    setCpuLimit(toFieldValue(resources?.cpuLimitCores ?? null));
    setCpuReservation(toFieldValue(resources?.cpuReservationCores ?? null));
    setMemoryLimit(toFieldValue(resources?.memoryLimitMb ?? null));
    setMemoryReservation(toFieldValue(resources?.memoryReservationMb ?? null));
  }, [resources]);

  const isDirty =
    cpuLimit !== toFieldValue(resources?.cpuLimitCores ?? null) ||
    cpuReservation !== toFieldValue(resources?.cpuReservationCores ?? null) ||
    memoryLimit !== toFieldValue(resources?.memoryLimitMb ?? null) ||
    memoryReservation !== toFieldValue(resources?.memoryReservationMb ?? null);

  async function handleSave() {
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        resources: {
          cpuLimitCores: parseNumber(cpuLimit),
          cpuReservationCores: parseNumber(cpuReservation),
          memoryLimitMb: parseNumber(memoryLimit),
          memoryReservationMb: parseNumber(memoryReservation)
        }
      });
      await onSaved();
      setFeedback("Saved DaoFlow-managed resource overrides.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save resource overrides right now."
      );
    }
  }

  function handleReset() {
    setCpuLimit(toFieldValue(resources?.cpuLimitCores ?? null));
    setCpuReservation(toFieldValue(resources?.cpuReservationCores ?? null));
    setMemoryLimit(toFieldValue(resources?.memoryLimitMb ?? null));
    setMemoryReservation(toFieldValue(resources?.memoryReservationMb ?? null));
    setFeedback(null);
  }

  return (
    <Card className="shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          <Cpu size={14} />
          Resource Overrides
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-4 text-sm text-muted-foreground">
          Empty values inherit from the source compose files. Saved overrides are merged into the
          rendered compose stack on deploy.
        </p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ResourceInput
            label="CPU Limit"
            value={cpuLimit}
            onChange={setCpuLimit}
            placeholder="1.0"
            step="0.25"
            hint="Maximum CPU cores."
            testId={`service-resource-cpu-limit-${serviceId}`}
          />
          <ResourceInput
            label="CPU Reservation"
            value={cpuReservation}
            onChange={setCpuReservation}
            placeholder="0.5"
            step="0.25"
            hint="Reserved CPU cores."
            testId={`service-resource-cpu-reservation-${serviceId}`}
          />
          <ResourceInput
            label="Memory Limit (MB)"
            value={memoryLimit}
            onChange={setMemoryLimit}
            placeholder="512"
            step="128"
            hint="Hard memory ceiling in megabytes."
            testId={`service-resource-memory-limit-${serviceId}`}
          />
          <ResourceInput
            label="Memory Reservation (MB)"
            value={memoryReservation}
            onChange={setMemoryReservation}
            placeholder="256"
            step="128"
            hint="Reserved memory in megabytes."
            testId={`service-resource-memory-reservation-${serviceId}`}
          />
        </div>
        {feedback ? (
          <p
            className="mt-4 text-sm text-muted-foreground"
            data-testid={`service-resource-feedback-${serviceId}`}
          >
            {feedback}
          </p>
        ) : null}
        <div className="flex justify-end gap-2 mt-4">
          <Button
            size="sm"
            variant="outline"
            onClick={handleReset}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-resource-reset-${serviceId}`}
          >
            <RotateCcw size={14} className="mr-1" />
            Reset
          </Button>
          <Button
            size="sm"
            onClick={() => void handleSave()}
            disabled={!isDirty || updateRuntimeConfig.isPending}
            data-testid={`service-resource-save-${serviceId}`}
          >
            <Save size={14} className="mr-1" />
            {updateRuntimeConfig.isPending ? "Saving..." : "Save Overrides"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function ResourceInput({
  label,
  value,
  onChange,
  placeholder,
  step,
  hint,
  testId
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
  step: string;
  hint: string;
  testId: string;
}) {
  return (
    <div>
      <label className="text-xs text-muted-foreground block mb-1.5">{label}</label>
      <div className="flex items-center gap-1">
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const next = Math.max(0, (parseFloat(value) || 0) - parseFloat(step));
            onChange(next > 0 ? String(next) : "");
          }}
          type="button"
        >
          -
        </Button>
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-8 text-sm text-center"
          placeholder={placeholder}
          type="number"
          step={step}
          min="0"
          data-testid={testId}
        />
        <Button
          size="sm"
          variant="outline"
          className="h-8 w-8 p-0"
          onClick={() => {
            const next = (parseFloat(value) || 0) + parseFloat(step);
            onChange(String(next));
          }}
          type="button"
        >
          +
        </Button>
      </div>
      <p className="text-xs text-muted-foreground mt-1">{hint}</p>
    </div>
  );
}
