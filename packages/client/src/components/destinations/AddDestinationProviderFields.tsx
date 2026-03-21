import { Check, Copy, Terminal } from "lucide-react";
import type { AddDestinationFormState } from "./add-destination-types";
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
import {
  S3_SUB_PROVIDERS,
  isOAuthProvider,
  usesRemoteConfig
} from "./add-destination-provider-config";
import { Button } from "@/components/ui/button";

interface AddDestinationProviderFieldsProps {
  form: AddDestinationFormState;
  copied: boolean;
  authorizeCommand?: string;
  onCopyAuthorizeCommand: () => void;
  onFieldChange: (field: keyof AddDestinationFormState, value: string) => void;
}

export function AddDestinationProviderFields({
  form,
  copied,
  authorizeCommand,
  onCopyAuthorizeCommand,
  onFieldChange
}: AddDestinationProviderFieldsProps) {
  if (form.provider === "s3") {
    return (
      <>
        <div className="grid gap-1.5">
          <Label htmlFor="destination-s3-provider">S3 Provider</Label>
          <Select
            value={form.s3Provider}
            onValueChange={(value) => onFieldChange("s3Provider", value)}
          >
            <SelectTrigger
              id="destination-s3-provider"
              aria-label="S3 provider"
              data-testid="destination-s3-provider-select"
            >
              <SelectValue placeholder="Select S3 provider" />
            </SelectTrigger>
            <SelectContent>
              {S3_SUB_PROVIDERS.map((provider) => (
                <SelectItem key={provider.key} value={provider.key}>
                  {provider.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="destination-access-key">Access Key</Label>
            <Input
              id="destination-access-key"
              data-testid="destination-access-key"
              placeholder="AKIAIOSFODNN7"
              value={form.accessKey}
              onChange={(event) => onFieldChange("accessKey", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destination-secret-key">Secret Key</Label>
            <Input
              id="destination-secret-key"
              data-testid="destination-secret-key"
              type="password"
              placeholder="wJalrXUtnFEMI/K7"
              value={form.secretKey}
              onChange={(event) => onFieldChange("secretKey", event.target.value)}
            />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="destination-bucket">Bucket</Label>
            <Input
              id="destination-bucket"
              data-testid="destination-bucket"
              placeholder="my-backups"
              value={form.bucket}
              onChange={(event) => onFieldChange("bucket", event.target.value)}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="destination-region">Region</Label>
            <Input
              id="destination-region"
              data-testid="destination-region"
              placeholder="us-east-1"
              value={form.region}
              onChange={(event) => onFieldChange("region", event.target.value)}
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="destination-endpoint">Endpoint</Label>
          <Input
            id="destination-endpoint"
            data-testid="destination-endpoint"
            placeholder="https://s3.amazonaws.com"
            value={form.endpoint}
            onChange={(event) => onFieldChange("endpoint", event.target.value)}
          />
        </div>
      </>
    );
  }

  if (form.provider === "local") {
    return (
      <div className="grid gap-1.5">
        <Label htmlFor="destination-local-path">Local Path</Label>
        <Input
          id="destination-local-path"
          data-testid="destination-local-path"
          placeholder="/tmp/daoflow-backups"
          value={form.localPath}
          onChange={(event) => onFieldChange("localPath", event.target.value)}
        />
      </div>
    );
  }

  if (isOAuthProvider(form.provider)) {
    return (
      <>
        {authorizeCommand ? (
          <div className="space-y-2 rounded-lg border bg-muted/50 p-3">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Terminal size={14} />
              Run this on a machine with a browser to get your token:
            </div>
            <div className="flex items-center gap-2">
              <code
                className="flex-1 rounded border bg-background px-3 py-2 font-mono text-sm"
                data-testid="destination-authorize-command"
              >
                {authorizeCommand}
              </code>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="shrink-0"
                data-testid="destination-authorize-copy-button"
                aria-label="Copy authorize command"
                title="Copy authorize command"
                onClick={onCopyAuthorizeCommand}
              >
                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">Paste the resulting JSON token below.</p>
          </div>
        ) : null}
        <div className="grid gap-1.5">
          <Label htmlFor="destination-oauth-token">OAuth Token</Label>
          <Textarea
            id="destination-oauth-token"
            data-testid="destination-oauth-token"
            className="font-mono text-xs"
            placeholder='{"access_token":"...","token_type":"Bearer",...}'
            rows={4}
            value={form.rcloneConfig}
            onChange={(event) => onFieldChange("rcloneConfig", event.target.value)}
          />
        </div>
      </>
    );
  }

  if (usesRemoteConfig(form.provider)) {
    return (
      <>
        <div className="grid gap-1.5">
          <Label htmlFor="destination-rclone-config">Rclone Config (INI format)</Label>
          <Textarea
            id="destination-rclone-config"
            data-testid="destination-rclone-config"
            className="font-mono text-xs"
            placeholder={"[remote]\ntype = sftp\nhost = backup.example.com\nuser = admin"}
            rows={4}
            value={form.rcloneConfig}
            onChange={(event) => onFieldChange("rcloneConfig", event.target.value)}
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="destination-rclone-remote-path">Remote Path</Label>
          <Input
            id="destination-rclone-remote-path"
            data-testid="destination-rclone-remote-path"
            placeholder="backups/daoflow"
            value={form.rcloneRemotePath}
            onChange={(event) => onFieldChange("rcloneRemotePath", event.target.value)}
          />
        </div>
      </>
    );
  }

  return null;
}
