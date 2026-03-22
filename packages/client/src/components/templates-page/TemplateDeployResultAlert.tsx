import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { TemplateDeployResult } from "./types";

interface TemplateDeployResultAlertProps {
  deployResult: TemplateDeployResult;
  onOpenDeployments: () => void;
  onOpenService: () => void;
}

export function TemplateDeployResultAlert({
  deployResult,
  onOpenDeployments,
  onOpenService
}: TemplateDeployResultAlertProps) {
  return (
    <Alert data-testid="template-apply-success">
      <AlertTitle>Deployment queued</AlertTitle>
      <AlertDescription className="space-y-3">
        <p>
          Queued <strong>{deployResult.projectName}</strong> as deployment{" "}
          <strong>{deployResult.deploymentId}</strong>.
        </p>
        <div className="flex flex-wrap gap-3">
          <Button onClick={onOpenService} data-testid="template-open-service-button">
            Open service
          </Button>
          <Button
            variant="secondary"
            onClick={onOpenDeployments}
            data-testid="template-open-deployments-button"
          >
            Open deployments
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
