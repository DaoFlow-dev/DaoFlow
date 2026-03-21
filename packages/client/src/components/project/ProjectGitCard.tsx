import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { GitBranch, ExternalLink, Copy, RefreshCw } from "lucide-react";

interface ProjectGitCardProps {
  config: Record<string, unknown>;
  repoUrl?: string | null;
  repoFullName?: string | null;
  defaultBranch?: string | null;
  autoDeploy?: boolean;
}

export function ProjectGitCard({
  config,
  repoUrl: repoUrlProp,
  repoFullName,
  defaultBranch,
  autoDeploy: autoDeployProp
}: ProjectGitCardProps) {
  const repoUrl =
    repoUrlProp ?? (typeof config.repositoryUrl === "string" ? config.repositoryUrl : null);
  const branch = defaultBranch ?? (typeof config.branch === "string" ? config.branch : "main");
  const commitSha = typeof config.lastCommitSha === "string" ? config.lastCommitSha : null;
  const autoDeploy =
    autoDeployProp ?? (typeof config.autoDeploy === "boolean" ? config.autoDeploy : false);
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

  if (!repoUrl) return null;

  const shortUrl = repoFullName ?? repoUrl.replace(/^https?:\/\//, "").replace(/\.git$/, "");

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
        {/* Repo URL */}
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

        {/* Branch + SHA row */}
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

        {/* Webhook */}
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
