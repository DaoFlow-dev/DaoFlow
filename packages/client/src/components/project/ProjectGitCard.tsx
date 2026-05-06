import { useEffect, useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { GitBranch, ExternalLink, Copy, RefreshCw, Save } from "lucide-react";
import {
  ProjectGitCredentialFields,
  type RepositoryCredentialDraftKind
} from "./ProjectGitCredentialFields";

type RepositoryCredentialInput =
  | { kind: "https_token"; token: string; username?: string }
  | { kind: "https_basic"; username: string; password: string }
  | { kind: "ssh_key"; privateKey: string }
  | null;

interface ProjectGitCardProps {
  config: Record<string, unknown>;
  repoUrl?: string | null;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  autoDeployBranch?: string | null;
  autoDeploy?: boolean;
  isSaving?: boolean;
  errorMessage?: string | null;
  onSaveSettings?: (input: {
    defaultBranch: string;
    autoDeploy: boolean;
    autoDeployBranch: string;
    repositoryCredential?: RepositoryCredentialInput;
  }) => void;
}

export function ProjectGitCard({
  config,
  repoUrl: repoUrlProp,
  repoFullName,
  defaultBranch,
  autoDeployBranch,
  autoDeploy: autoDeployProp,
  isSaving = false,
  errorMessage,
  onSaveSettings
}: ProjectGitCardProps) {
  const repoUrl =
    repoUrlProp ?? (typeof config.repositoryUrl === "string" ? config.repositoryUrl : null);
  const branch = defaultBranch ?? (typeof config.branch === "string" ? config.branch : "main");
  const commitSha = typeof config.lastCommitSha === "string" ? config.lastCommitSha : null;
  const autoDeploy =
    autoDeployProp ?? (typeof config.autoDeploy === "boolean" ? config.autoDeploy : false);
  const deployBranch = autoDeployBranch ?? branch;
  const [draftBranch, setDraftBranch] = useState(branch);
  const [draftAutoDeploy, setDraftAutoDeploy] = useState(autoDeploy);
  const [draftDeployBranch, setDraftDeployBranch] = useState(deployBranch);
  const [credentialKind, setCredentialKind] = useState<RepositoryCredentialDraftKind>("unchanged");
  const [credentialUsername, setCredentialUsername] = useState("");
  const [credentialToken, setCredentialToken] = useState("");
  const [credentialPassword, setCredentialPassword] = useState("");
  const [credentialPrivateKey, setCredentialPrivateKey] = useState("");
  const provider =
    typeof config.gitProvider === "string"
      ? config.gitProvider
      : repoUrl?.includes("github.com")
        ? "GitHub"
        : repoUrl?.includes("gitlab")
          ? "GitLab"
          : repoUrl?.includes("bitbucket")
            ? "Bitbucket"
            : "Git";

  const shortUrl = repoFullName ?? repoUrl?.replace(/^https?:\/\//, "").replace(/\.git$/, "");
  const trimmedBranch = draftBranch.trim();
  const trimmedDeployBranch = draftDeployBranch.trim();
  const settingsChanged = useMemo(
    () =>
      trimmedBranch !== branch ||
      draftAutoDeploy !== autoDeploy ||
      trimmedDeployBranch !== deployBranch ||
      credentialKind !== "unchanged",
    [
      autoDeploy,
      branch,
      credentialKind,
      deployBranch,
      draftAutoDeploy,
      trimmedBranch,
      trimmedDeployBranch
    ]
  );
  const repositoryCredential = useMemo<RepositoryCredentialInput | undefined>(() => {
    if (credentialKind === "unchanged") return undefined;
    if (credentialKind === "clear") return null;
    if (credentialKind === "https_token" && credentialToken.trim()) {
      return {
        kind: "https_token",
        token: credentialToken,
        username: credentialUsername.trim() || undefined
      };
    }
    if (
      credentialKind === "https_basic" &&
      credentialUsername.trim() &&
      credentialPassword.trim()
    ) {
      return {
        kind: "https_basic",
        username: credentialUsername,
        password: credentialPassword
      };
    }
    if (credentialKind === "ssh_key" && credentialPrivateKey.trim()) {
      return { kind: "ssh_key", privateKey: credentialPrivateKey };
    }
    return undefined;
  }, [
    credentialKind,
    credentialPassword,
    credentialPrivateKey,
    credentialToken,
    credentialUsername
  ]);
  const credentialIncomplete = credentialKind !== "unchanged" && repositoryCredential === undefined;
  const saveDisabled =
    !onSaveSettings ||
    isSaving ||
    !trimmedBranch ||
    !trimmedDeployBranch ||
    !settingsChanged ||
    credentialIncomplete;

  useEffect(() => {
    setDraftBranch(branch);
    setDraftAutoDeploy(autoDeploy);
    setDraftDeployBranch(deployBranch);
    setCredentialKind("unchanged");
    setCredentialUsername("");
    setCredentialToken("");
    setCredentialPassword("");
    setCredentialPrivateKey("");
  }, [autoDeploy, branch, deployBranch]);

  const saveSettings = () => {
    if (saveDisabled) {
      return;
    }
    onSaveSettings?.({
      defaultBranch: trimmedBranch,
      autoDeploy: draftAutoDeploy,
      autoDeployBranch: trimmedDeployBranch,
      ...(credentialKind !== "unchanged" ? { repositoryCredential } : {})
    });
  };

  if (!repoUrl) return null;

  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <GitBranch size={16} />
            Git Repository
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {provider}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground mb-0.5">Repository</p>
            <p className="text-sm font-medium truncate">{shortUrl}</p>
          </div>
          <div className="flex gap-1">
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Copy URL"
              onClick={() => void navigator.clipboard.writeText(repoUrl)}
            >
              <Copy size={14} />
            </Button>
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              title="Open in browser"
              onClick={() => window.open(repoUrl, "_blank")}
            >
              <ExternalLink size={14} />
            </Button>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Branch</p>
            <Badge variant="secondary" className="text-xs font-mono">
              {branch}
            </Badge>
          </div>
          {commitSha && (
            <div>
              <p className="text-xs text-muted-foreground mb-0.5">Last Commit</p>
              <Badge variant="outline" className="text-xs font-mono">
                {commitSha.slice(0, 7)}
              </Badge>
            </div>
          )}
          <div>
            <p className="text-xs text-muted-foreground mb-0.5">Auto-deploy</p>
            <Badge variant={autoDeploy ? "default" : "secondary"} className="text-xs">
              {autoDeploy ? "Enabled" : "Disabled"}
            </Badge>
          </div>
        </div>

        {onSaveSettings ? (
          <div className="grid gap-3 border-t pt-3">
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="project-git-default-branch" className="text-xs">
                  Default branch
                </Label>
                <Input
                  id="project-git-default-branch"
                  value={draftBranch}
                  onChange={(event) => setDraftBranch(event.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="project-git-deploy-branch" className="text-xs">
                  Auto-deploy branch
                </Label>
                <Input
                  id="project-git-deploy-branch"
                  value={draftDeployBranch}
                  onChange={(event) => setDraftDeployBranch(event.target.value)}
                  className="h-8 font-mono text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <Switch
                  id="project-git-auto-deploy"
                  checked={draftAutoDeploy}
                  onCheckedChange={setDraftAutoDeploy}
                />
                <Label htmlFor="project-git-auto-deploy" className="text-xs">
                  Auto-deploy
                </Label>
              </div>
            </div>
            <ProjectGitCredentialFields
              credentialKind={credentialKind}
              credentialUsername={credentialUsername}
              credentialToken={credentialToken}
              credentialPassword={credentialPassword}
              credentialPrivateKey={credentialPrivateKey}
              onCredentialKind={setCredentialKind}
              onCredentialUsername={setCredentialUsername}
              onCredentialToken={setCredentialToken}
              onCredentialPassword={setCredentialPassword}
              onCredentialPrivateKey={setCredentialPrivateKey}
            />
            <div className="flex justify-end">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={saveDisabled}
                onClick={saveSettings}
              >
                <Save size={12} className="mr-1" />
                {isSaving ? "Saving" : "Save"}
              </Button>
            </div>
            {errorMessage ? <p className="text-xs text-destructive">{errorMessage}</p> : null}
          </div>
        ) : null}

        <div className="flex items-center gap-2 pt-1">
          <Button size="sm" variant="outline" className="text-xs h-7">
            <RefreshCw size={12} className="mr-1" />
            Redeploy from Git
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
