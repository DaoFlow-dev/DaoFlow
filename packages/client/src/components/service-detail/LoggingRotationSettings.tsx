import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, RotateCcw, Save } from "lucide-react";

interface LoggingRotationSettingsProps {
  serviceId: string;
  enabled: boolean;
  maxSizeMb: string;
  maxFiles: string;
  allowSourceOverride: boolean;
  feedback: string | null;
  isDirty: boolean;
  isPending: boolean;
  canClear: boolean;
  canSave: boolean;
  maxSizeMbLimit: number;
  maxFilesLimit: number;
  maxRetentionMb: number;
  onEnabledChange: (enabled: boolean) => void;
  onMaxSizeMbChange: (value: string) => void;
  onMaxFilesChange: (value: string) => void;
  onAllowSourceOverrideChange: (allow: boolean) => void;
  onClear: () => void;
  onReset: () => void;
  onSave: () => void;
}

export function LoggingRotationSettings({
  serviceId,
  enabled,
  maxSizeMb,
  maxFiles,
  allowSourceOverride,
  feedback,
  isDirty,
  isPending,
  canClear,
  canSave,
  maxSizeMbLimit,
  maxFilesLimit,
  maxRetentionMb,
  onEnabledChange,
  onMaxSizeMbChange,
  onMaxFilesChange,
  onAllowSourceOverrideChange,
  onClear,
  onReset,
  onSave
}: LoggingRotationSettingsProps) {
  return (
    <>
      <p
        className="text-sm text-muted-foreground"
        data-testid={`service-logging-description-${serviceId}`}
      >
        DaoFlow can manage Docker&apos;s json-file rotation for this service. The setting takes
        effect on the next deployment.
      </p>

      <div className="flex items-start justify-between gap-4 rounded-md border p-3">
        <div className="flex flex-col gap-1">
          <label className="text-sm font-medium" htmlFor={`service-logging-enabled-${serviceId}`}>
            Enable managed log rotation
          </label>
          <p className="text-xs text-muted-foreground">
            Defaults to 10 MB per file and 3 rotated files.
          </p>
        </div>
        <Switch
          id={`service-logging-enabled-${serviceId}`}
          checked={enabled}
          onCheckedChange={onEnabledChange}
          aria-label="Enable managed log rotation"
          data-testid={`service-logging-enabled-${serviceId}`}
        />
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`service-logging-size-${serviceId}`}
          >
            Maximum file size (MB)
          </label>
          <Input
            id={`service-logging-size-${serviceId}`}
            value={maxSizeMb}
            onChange={(event) => onMaxSizeMbChange(event.target.value)}
            className="h-8 text-sm"
            type="number"
            min="1"
            max={String(maxSizeMbLimit)}
            step="1"
            disabled={!enabled}
            aria-describedby={`service-logging-bounds-${serviceId}`}
            data-testid={`service-logging-max-size-${serviceId}`}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label
            className="text-xs text-muted-foreground"
            htmlFor={`service-logging-files-${serviceId}`}
          >
            Rotated files to keep
          </label>
          <Input
            id={`service-logging-files-${serviceId}`}
            value={maxFiles}
            onChange={(event) => onMaxFilesChange(event.target.value)}
            className="h-8 text-sm"
            type="number"
            min="1"
            max={String(maxFilesLimit)}
            step="1"
            disabled={!enabled}
            aria-describedby={`service-logging-bounds-${serviceId}`}
            data-testid={`service-logging-max-files-${serviceId}`}
          />
        </div>
      </div>
      <p
        className="-mt-2 text-xs text-muted-foreground"
        id={`service-logging-bounds-${serviceId}`}
        data-testid={`service-logging-bounds-${serviceId}`}
      >
        Use whole numbers from 1 to {maxSizeMbLimit} MB and 1 to {maxFilesLimit} files. Combined
        retention cannot exceed {maxRetentionMb} MB per container.
      </p>

      <div className="flex flex-col gap-3 rounded-md border p-3">
        <div className="flex items-start justify-between gap-4">
          <div className="flex flex-col gap-1">
            <label
              className="text-sm font-medium"
              htmlFor={`service-logging-source-override-${serviceId}`}
            >
              Allow source logging to be replaced
            </label>
            <p className="text-xs text-muted-foreground">
              Keep this off to preserve logging authored in the source Compose service.
            </p>
          </div>
          <Switch
            id={`service-logging-source-override-${serviceId}`}
            checked={allowSourceOverride}
            onCheckedChange={onAllowSourceOverrideChange}
            disabled={!enabled}
            aria-label="Allow DaoFlow to replace source-authored Compose logging"
            data-testid={`service-logging-source-override-${serviceId}`}
          />
        </div>
        {enabled && allowSourceOverride ? (
          <Alert variant="destructive" data-testid={`service-logging-source-warning-${serviceId}`}>
            <AlertTriangle />
            <AlertTitle>Source logging ownership will change</AlertTitle>
            <AlertDescription>
              Warning: on the next deployment, DaoFlow may replace logging already authored in the
              source Compose service with this managed json-file configuration.
            </AlertDescription>
          </Alert>
        ) : null}
      </div>

      {feedback ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid={`service-logging-feedback-${serviceId}`}
        >
          {feedback}
        </p>
      ) : null}

      <div className="flex flex-wrap justify-end gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={onClear}
          disabled={!canClear}
          data-testid={`service-logging-clear-${serviceId}`}
        >
          Clear Managed Setting
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={onReset}
          disabled={!isDirty || isPending}
          data-testid={`service-logging-reset-${serviceId}`}
        >
          <RotateCcw data-icon="inline-start" />
          Reset
        </Button>
        <Button
          size="sm"
          onClick={onSave}
          disabled={!canSave}
          data-testid={`service-logging-save-${serviceId}`}
        >
          <Save data-icon="inline-start" />
          {isPending ? "Saving..." : "Save Rotation"}
        </Button>
      </div>
    </>
  );
}
