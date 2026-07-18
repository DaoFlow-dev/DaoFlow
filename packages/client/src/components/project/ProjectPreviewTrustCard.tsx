import { useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

const previewPolicies = [
  {
    value: "disabled",
    label: "Disabled",
    description: "Do not create pull-request previews from provider webhooks."
  },
  {
    value: "manual-approval",
    label: "Manual approval",
    description:
      "Require a human to approve each exact same-repository commit before preview inputs are prepared."
  }
] as const;

type PreviewPolicy = (typeof previewPolicies)[number]["value"];

function isPreviewPolicy(value: unknown): value is PreviewPolicy {
  return previewPolicies.some((policy) => policy.value === value);
}

interface ProjectPreviewTrustCardProps {
  previewPolicy?: string | null;
  previewPolicyRevision?: number | null;
  isSaving?: boolean;
  errorMessage?: string | null;
  onSave?: (previewPolicy: PreviewPolicy) => void;
}

export function ProjectPreviewTrustCard({
  previewPolicy,
  previewPolicyRevision,
  isSaving = false,
  errorMessage,
  onSave
}: ProjectPreviewTrustCardProps) {
  const policy = isPreviewPolicy(previewPolicy) ? previewPolicy : "manual-approval";
  const [draftPolicy, setDraftPolicy] = useState<PreviewPolicy>(policy);
  const selectedPolicy =
    previewPolicies.find((candidate) => candidate.value === draftPolicy) ?? previewPolicies[1];

  useEffect(() => {
    setDraftPolicy(policy);
  }, [policy]);

  return (
    <Card data-testid="project-preview-trust-card">
      <CardHeader className="gap-1 pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck aria-hidden="true" />
          Preview trust
        </CardTitle>
        <CardDescription data-testid="project-preview-policy-status">
          Policy revision {previewPolicyRevision ?? 1}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Alert data-testid="project-preview-trust-guidance">
          <ShieldCheck aria-hidden="true" />
          <AlertTitle>Fork previews are unavailable</AlertTitle>
          <AlertDescription>
            DaoFlow does not run fork-without-secrets previews. Under manual approval, review the
            exact commit in Approvals before any environment values are prepared.
          </AlertDescription>
        </Alert>
        <div className="flex flex-col gap-2">
          <Label htmlFor="project-preview-policy">Pull-request preview policy</Label>
          <Select
            value={draftPolicy}
            onValueChange={(value) => {
              if (isPreviewPolicy(value)) {
                setDraftPolicy(value);
              }
            }}
          >
            <SelectTrigger id="project-preview-policy" data-testid="project-preview-policy">
              <SelectValue placeholder="Select a preview policy" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                <SelectLabel>Preview policy</SelectLabel>
                {previewPolicies.map((candidate) => (
                  <SelectItem key={candidate.value} value={candidate.value}>
                    {candidate.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
          <p
            className="text-sm text-muted-foreground"
            data-testid="project-preview-policy-description"
          >
            {selectedPolicy.description}
          </p>
        </div>
        {errorMessage ? (
          <p className="text-sm text-destructive" data-testid="project-preview-policy-error">
            {errorMessage}
          </p>
        ) : null}
      </CardContent>
      <CardFooter className="justify-end">
        <Button
          size="sm"
          disabled={!onSave || isSaving || draftPolicy === policy}
          data-testid="project-preview-policy-save"
          onClick={() => onSave?.(draftPolicy)}
        >
          {isSaving ? "Saving" : "Save preview policy"}
        </Button>
      </CardFooter>
    </Card>
  );
}
