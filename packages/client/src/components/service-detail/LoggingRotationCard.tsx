import { useEffect, useState } from "react";
import { isTRPCClientError } from "@trpc/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { trpc } from "@/lib/trpc";
import { FileText } from "lucide-react";
import { LoggingRotationInspection } from "./LoggingRotationInspection";
import { LoggingRotationSettings } from "./LoggingRotationSettings";
import type { ServiceRuntimeLogging } from "./runtime-config";

interface LoggingRotationCardProps {
  serviceId: string;
  logging: ServiceRuntimeLogging | null;
  onSaved: () => Promise<unknown>;
}

const DEFAULT_MAX_SIZE_MB = 10;
const DEFAULT_MAX_FILES = 3;
const MAX_SIZE_MB = 1024;
const MAX_FILES = 20;
const MAX_RETENTION_MB = 4096;

function toFieldValue(value: number | undefined, fallback: number): string {
  return String(value ?? fallback);
}

function parseBoundedInteger(value: string, maximum: number): number | null {
  if (!value.trim()) {
    return null;
  }

  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    return null;
  }

  return parsed;
}

export function LoggingRotationCard({ serviceId, logging, onSaved }: LoggingRotationCardProps) {
  const inspectionQuery = trpc.serviceLoggingState.useQuery({ serviceId }, { enabled: false });
  const updateRuntimeConfig = trpc.updateServiceRuntimeConfig.useMutation();
  const [enabled, setEnabled] = useState(logging !== null);
  const [maxSizeMb, setMaxSizeMb] = useState(toFieldValue(logging?.maxSizeMb, DEFAULT_MAX_SIZE_MB));
  const [maxFiles, setMaxFiles] = useState(toFieldValue(logging?.maxFiles, DEFAULT_MAX_FILES));
  const [allowSourceOverride, setAllowSourceOverride] = useState(
    logging?.allowSourceOverride ?? false
  );
  const [feedback, setFeedback] = useState<string | null>(null);

  useEffect(() => {
    setEnabled(logging !== null);
    setMaxSizeMb(toFieldValue(logging?.maxSizeMb, DEFAULT_MAX_SIZE_MB));
    setMaxFiles(toFieldValue(logging?.maxFiles, DEFAULT_MAX_FILES));
    setAllowSourceOverride(logging?.allowSourceOverride ?? false);
  }, [logging]);

  const persistedMaxSizeMb = toFieldValue(logging?.maxSizeMb, DEFAULT_MAX_SIZE_MB);
  const persistedMaxFiles = toFieldValue(logging?.maxFiles, DEFAULT_MAX_FILES);
  const persistedAllowSourceOverride = logging?.allowSourceOverride ?? false;
  const isDirty =
    enabled !== (logging !== null) ||
    (enabled &&
      (maxSizeMb !== persistedMaxSizeMb ||
        maxFiles !== persistedMaxFiles ||
        allowSourceOverride !== persistedAllowSourceOverride));
  const desired = inspectionQuery.data ? inspectionQuery.data.desired : logging;

  async function refreshCachedInspection() {
    if (inspectionQuery.data || inspectionQuery.error) {
      await inspectionQuery.refetch();
    }
  }

  async function handleSave() {
    setFeedback(null);

    if (!enabled) {
      try {
        await updateRuntimeConfig.mutateAsync({
          serviceId,
          logging: null
        });
        await onSaved();
        await refreshCachedInspection();
        setFeedback("Removed managed log rotation. Source-authored logging will be preserved.");
      } catch (error) {
        setFeedback(
          isTRPCClientError(error)
            ? error.message
            : "Unable to remove managed log rotation right now."
        );
      }
      return;
    }

    const parsedMaxSizeMb = parseBoundedInteger(maxSizeMb, MAX_SIZE_MB);
    const parsedMaxFiles = parseBoundedInteger(maxFiles, MAX_FILES);
    if (parsedMaxSizeMb === null || parsedMaxFiles === null) {
      setFeedback(
        `Log rotation requires whole numbers: size 1–${MAX_SIZE_MB} MB and files 1–${MAX_FILES}.`
      );
      return;
    }

    if (parsedMaxSizeMb * parsedMaxFiles > MAX_RETENTION_MB) {
      setFeedback(`Combined log retention cannot exceed ${MAX_RETENTION_MB} MB per container.`);
      return;
    }

    const nextLogging: ServiceRuntimeLogging = {
      managed: true,
      driver: "json-file",
      maxSizeMb: parsedMaxSizeMb,
      maxFiles: parsedMaxFiles,
      allowSourceOverride
    };

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        logging: nextLogging
      });
      await onSaved();
      await refreshCachedInspection();
      setFeedback("Saved managed Docker log rotation.");
    } catch (error) {
      setFeedback(
        isTRPCClientError(error) ? error.message : "Unable to save managed log rotation right now."
      );
    }
  }

  function handleReset() {
    setEnabled(logging !== null);
    setMaxSizeMb(persistedMaxSizeMb);
    setMaxFiles(persistedMaxFiles);
    setAllowSourceOverride(persistedAllowSourceOverride);
    setFeedback(null);
  }

  async function handleClear() {
    setEnabled(false);
    setFeedback(null);

    try {
      await updateRuntimeConfig.mutateAsync({
        serviceId,
        logging: null
      });
      await onSaved();
      await refreshCachedInspection();
      setMaxSizeMb(String(DEFAULT_MAX_SIZE_MB));
      setMaxFiles(String(DEFAULT_MAX_FILES));
      setAllowSourceOverride(false);
      setFeedback("Removed managed log rotation. Source-authored logging will be preserved.");
    } catch (error) {
      setEnabled(logging !== null);
      setFeedback(
        isTRPCClientError(error)
          ? error.message
          : "Unable to remove managed log rotation right now."
      );
    }
  }

  const canClear = logging !== null && !updateRuntimeConfig.isPending;
  const canSave = isDirty && !updateRuntimeConfig.isPending;

  return (
    <Card className="shadow-sm" data-testid={`service-logging-card-${serviceId}`}>
      <CardHeader>
        <CardTitle
          className="flex items-center gap-2 text-sm"
          data-testid={`service-logging-title-${serviceId}`}
        >
          <FileText size={14} />
          Docker Log Rotation
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <LoggingRotationSettings
          serviceId={serviceId}
          enabled={enabled}
          maxSizeMb={maxSizeMb}
          maxFiles={maxFiles}
          allowSourceOverride={allowSourceOverride}
          feedback={feedback}
          isDirty={isDirty}
          isPending={updateRuntimeConfig.isPending}
          canClear={canClear}
          canSave={canSave}
          maxSizeMbLimit={MAX_SIZE_MB}
          maxFilesLimit={MAX_FILES}
          maxRetentionMb={MAX_RETENTION_MB}
          onEnabledChange={setEnabled}
          onMaxSizeMbChange={setMaxSizeMb}
          onMaxFilesChange={setMaxFiles}
          onAllowSourceOverrideChange={setAllowSourceOverride}
          onClear={() => void handleClear()}
          onReset={handleReset}
          onSave={() => void handleSave()}
        />
        <Separator />
        <LoggingRotationInspection
          serviceId={serviceId}
          desired={desired}
          inspectionQuery={inspectionQuery}
        />
      </CardContent>
    </Card>
  );
}
