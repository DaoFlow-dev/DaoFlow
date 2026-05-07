import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";

export interface GitProviderOption {
  id: string;
  type: string;
  name: string;
  status?: string | null;
  baseUrl?: string | null;
}

export interface GitInstallationOption {
  id: string;
  providerId: string;
  installationId: string;
  accountName: string;
  accountType?: string | null;
  status?: string | null;
}

export interface ProjectSourceFieldValue {
  repoUrl: string;
  gitProviderId: string;
  gitInstallationId: string;
  repoFullName: string;
  defaultBranch: string;
  autoDeploy: string;
  autoDeployBranch: string;
  composePath: string;
}

interface ProjectSourceFieldsProps {
  value: ProjectSourceFieldValue;
  providers: GitProviderOption[];
  installations: GitInstallationOption[];
  testIdPrefix: string;
  onChange: (field: keyof ProjectSourceFieldValue, value: string) => void;
}

function providerLabel(provider: GitProviderOption) {
  const baseUrl = provider.baseUrl ? ` (${provider.baseUrl})` : "";
  return `${provider.name} - ${provider.type}${baseUrl}`;
}

function installationLabel(installation: GitInstallationOption) {
  return `${installation.accountName} (${installation.accountType ?? installation.installationId})`;
}

export function ProjectSourceFields({
  value,
  providers,
  installations,
  testIdPrefix,
  onChange
}: ProjectSourceFieldsProps) {
  const hasProvider = value.gitProviderId !== "none";
  const providerInstallations = installations.filter(
    (installation) => installation.providerId === value.gitProviderId
  );

  return (
    <div className="space-y-4 rounded-md border border-border p-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${testIdPrefix}-git-provider`}>Git Provider</Label>
          <Select
            value={value.gitProviderId}
            onValueChange={(nextValue) => {
              if (nextValue === null) {
                return;
              }
              onChange("gitProviderId", nextValue);
              onChange("gitInstallationId", "none");
            }}
          >
            <SelectTrigger
              id={`${testIdPrefix}-git-provider`}
              data-testid={`${testIdPrefix}-git-provider`}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {providers.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {providerLabel(provider)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${testIdPrefix}-git-installation`}>Git Installation</Label>
          <Select
            value={value.gitInstallationId}
            onValueChange={(nextValue) => {
              if (nextValue !== null) {
                onChange("gitInstallationId", nextValue);
              }
            }}
          >
            <SelectTrigger
              id={`${testIdPrefix}-git-installation`}
              data-testid={`${testIdPrefix}-git-installation`}
              disabled={!hasProvider}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              {providerInstallations.map((installation) => (
                <SelectItem key={installation.id} value={installation.id}>
                  {installationLabel(installation)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${testIdPrefix}-repo-full-name`}>Repository Full Name</Label>
        <Input
          id={`${testIdPrefix}-repo-full-name`}
          data-testid={`${testIdPrefix}-repo-full-name`}
          placeholder="group/project"
          value={value.repoFullName}
          onChange={(event) => onChange("repoFullName", event.target.value)}
          maxLength={300}
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor={`${testIdPrefix}-repo-url`}>Repository URL</Label>
        <Input
          id={`${testIdPrefix}-repo-url`}
          data-testid={`${testIdPrefix}-repo-url`}
          placeholder="https://github.com/org/repo"
          value={value.repoUrl}
          onChange={(event) => onChange("repoUrl", event.target.value)}
          maxLength={300}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor={`${testIdPrefix}-default-branch`}>Default Branch</Label>
          <Input
            id={`${testIdPrefix}-default-branch`}
            data-testid={`${testIdPrefix}-default-branch`}
            placeholder="main"
            value={value.defaultBranch}
            onChange={(event) => onChange("defaultBranch", event.target.value)}
            maxLength={120}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor={`${testIdPrefix}-compose-path`}>Compose Path</Label>
          <Input
            id={`${testIdPrefix}-compose-path`}
            data-testid={`${testIdPrefix}-compose-path`}
            placeholder="compose.yaml"
            value={value.composePath}
            onChange={(event) => onChange("composePath", event.target.value)}
            maxLength={300}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
        <Label htmlFor={`${testIdPrefix}-auto-deploy`}>Webhook Auto-Deploy</Label>
        <Switch
          id={`${testIdPrefix}-auto-deploy`}
          data-testid={`${testIdPrefix}-auto-deploy`}
          checked={value.autoDeploy === "true"}
          onCheckedChange={(checked) => onChange("autoDeploy", checked ? "true" : "false")}
        />
      </div>

      {value.autoDeploy === "true" ? (
        <div className="space-y-2">
          <Label htmlFor={`${testIdPrefix}-auto-deploy-branch`}>Auto-Deploy Branch</Label>
          <Input
            id={`${testIdPrefix}-auto-deploy-branch`}
            data-testid={`${testIdPrefix}-auto-deploy-branch`}
            placeholder={value.defaultBranch || "main"}
            value={value.autoDeployBranch}
            onChange={(event) => onChange("autoDeployBranch", event.target.value)}
            maxLength={120}
          />
        </div>
      ) : null}
    </div>
  );
}
