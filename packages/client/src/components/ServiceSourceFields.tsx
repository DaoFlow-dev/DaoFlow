import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const serviceSourceTypes = ["compose", "dockerfile", "image"] as const;
export type ServiceSourceType = "compose" | "dockerfile" | "image";

interface ServiceSourceFieldsProps {
  sourceType: ServiceSourceType;
  imageReference: string;
  dockerfilePath: string;
  composeServiceName: string;
  onSourceTypeChange: (sourceType: ServiceSourceType) => void;
  onImageReferenceChange: (value: string) => void;
  onDockerfilePathChange: (value: string) => void;
  onComposeServiceNameChange: (value: string) => void;
}

export function ServiceSourceFields({
  sourceType,
  imageReference,
  dockerfilePath,
  composeServiceName,
  onSourceTypeChange,
  onImageReferenceChange,
  onDockerfilePathChange,
  onComposeServiceNameChange
}: ServiceSourceFieldsProps) {
  return (
    <>
      <div>
        <Label>Source Type</Label>
        <div className="flex gap-2 mt-1">
          {serviceSourceTypes.map((source) => (
            <Button
              key={source}
              type="button"
              variant={sourceType === source ? "default" : "outline"}
              size="sm"
              onClick={() => onSourceTypeChange(source)}
              data-testid={`add-service-source-${source}`}
            >
              {source}
            </Button>
          ))}
        </div>
      </div>

      {sourceType === "image" ? (
        <div>
          <Label htmlFor="svc-image">Image Reference</Label>
          <Input
            id="svc-image"
            value={imageReference}
            onChange={(event) => onImageReferenceChange(event.target.value)}
            placeholder="e.g. nginx:latest"
          />
        </div>
      ) : null}

      {sourceType === "dockerfile" ? (
        <div>
          <Label htmlFor="svc-dockerfile">Dockerfile Path</Label>
          <Input
            id="svc-dockerfile"
            value={dockerfilePath}
            onChange={(event) => onDockerfilePathChange(event.target.value)}
            placeholder="e.g. ./Dockerfile"
          />
        </div>
      ) : null}

      {sourceType === "compose" ? (
        <div>
          <Label htmlFor="svc-compose">Compose Service Name</Label>
          <Input
            id="svc-compose"
            value={composeServiceName}
            onChange={(event) => onComposeServiceNameChange(event.target.value)}
            placeholder="e.g. web, db, redis"
          />
        </div>
      ) : null}
    </>
  );
}
