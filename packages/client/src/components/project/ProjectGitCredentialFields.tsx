import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

export type RepositoryCredentialDraftKind =
  "unchanged" | "clear" | "https_token" | "https_basic" | "ssh_key";

function isRepositoryCredentialDraftKind(value: unknown): value is RepositoryCredentialDraftKind {
  return (
    value === "unchanged" ||
    value === "clear" ||
    value === "https_token" ||
    value === "https_basic" ||
    value === "ssh_key"
  );
}

interface ProjectGitCredentialFieldsProps {
  credentialKind: RepositoryCredentialDraftKind;
  credentialUsername: string;
  credentialToken: string;
  credentialPassword: string;
  credentialPrivateKey: string;
  onCredentialKind: (value: RepositoryCredentialDraftKind) => void;
  onCredentialUsername: (value: string) => void;
  onCredentialToken: (value: string) => void;
  onCredentialPassword: (value: string) => void;
  onCredentialPrivateKey: (value: string) => void;
}

export function ProjectGitCredentialFields({
  credentialKind,
  credentialUsername,
  credentialToken,
  credentialPassword,
  credentialPrivateKey,
  onCredentialKind,
  onCredentialUsername,
  onCredentialToken,
  onCredentialPassword,
  onCredentialPrivateKey
}: ProjectGitCredentialFieldsProps) {
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      <div className="space-y-1">
        <Label htmlFor="project-git-credential-kind" className="text-xs">
          Repository Credential
        </Label>
        <Select
          value={credentialKind}
          onValueChange={(value) => {
            if (isRepositoryCredentialDraftKind(value)) {
              onCredentialKind(value);
            }
          }}
        >
          <SelectTrigger
            id="project-git-credential-kind"
            className="h-8"
            data-testid="project-git-credential-kind"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="unchanged">Keep current</SelectItem>
            <SelectItem value="clear">Clear credential</SelectItem>
            <SelectItem value="https_token">HTTPS token</SelectItem>
            <SelectItem value="https_basic">HTTPS basic</SelectItem>
            <SelectItem value="ssh_key">SSH key</SelectItem>
          </SelectContent>
        </Select>
      </div>
      {credentialKind === "https_token" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="project-git-credential-username" className="text-xs">
              Username
            </Label>
            <Input
              id="project-git-credential-username"
              className="h-8"
              value={credentialUsername}
              onChange={(event) => onCredentialUsername(event.target.value)}
              data-testid="project-git-credential-username"
            />
          </div>
          <div className="space-y-1 sm:col-span-2">
            <Label htmlFor="project-git-credential-token" className="text-xs">
              Token
            </Label>
            <Input
              id="project-git-credential-token"
              type="password"
              className="h-8"
              value={credentialToken}
              onChange={(event) => onCredentialToken(event.target.value)}
              data-testid="project-git-credential-token"
            />
          </div>
        </>
      ) : null}
      {credentialKind === "https_basic" ? (
        <>
          <div className="space-y-1">
            <Label htmlFor="project-git-credential-basic-username" className="text-xs">
              Username
            </Label>
            <Input
              id="project-git-credential-basic-username"
              className="h-8"
              value={credentialUsername}
              onChange={(event) => onCredentialUsername(event.target.value)}
              data-testid="project-git-credential-basic-username"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="project-git-credential-password" className="text-xs">
              Password
            </Label>
            <Input
              id="project-git-credential-password"
              type="password"
              className="h-8"
              value={credentialPassword}
              onChange={(event) => onCredentialPassword(event.target.value)}
              data-testid="project-git-credential-password"
            />
          </div>
        </>
      ) : null}
      {credentialKind === "ssh_key" ? (
        <div className="space-y-1 sm:col-span-2">
          <Label htmlFor="project-git-credential-ssh-key" className="text-xs">
            Private Key
          </Label>
          <Textarea
            id="project-git-credential-ssh-key"
            className="min-h-24 font-mono text-xs"
            value={credentialPrivateKey}
            onChange={(event) => onCredentialPrivateKey(event.target.value)}
            data-testid="project-git-credential-ssh-key"
          />
        </div>
      ) : null}
    </div>
  );
}
