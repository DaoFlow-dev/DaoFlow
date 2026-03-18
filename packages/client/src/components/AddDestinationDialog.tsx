import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
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
import { Plus } from "lucide-react";
import { useState } from "react";

const PROVIDERS = [
  { key: "s3" as const, name: "S3-Compatible Storage", icon: "☁️" },
  { key: "gdrive" as const, name: "Google Drive", icon: "📁" },
  { key: "onedrive" as const, name: "Microsoft OneDrive", icon: "📂" },
  { key: "dropbox" as const, name: "Dropbox", icon: "📦" },
  { key: "sftp" as const, name: "SFTP / SSH", icon: "🔒" },
  { key: "local" as const, name: "Local Filesystem", icon: "💾" },
  { key: "rclone" as const, name: "Custom Rclone Config", icon: "⚙️" }
] as const;

export type ProviderKey = (typeof PROVIDERS)[number]["key"];

const S3_SUB_PROVIDERS = [
  { key: "AWS", name: "Amazon Web Services (AWS) S3" },
  { key: "Cloudflare", name: "Cloudflare R2" },
  { key: "DigitalOcean", name: "DigitalOcean Spaces" },
  { key: "GCS", name: "Google Cloud Storage" },
  { key: "Minio", name: "MinIO" },
  { key: "Wasabi", name: "Wasabi" },
  { key: "Other", name: "Any S3-compatible provider" }
];

export interface DestinationFormData {
  name: string;
  provider: ProviderKey;
  accessKey?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  s3Provider?: string;
  localPath?: string;
  rcloneConfig?: string;
  rcloneRemotePath?: string;
  oauthToken?: string;
}

interface AddDestinationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: DestinationFormData) => void;
  isPending: boolean;
}

export function AddDestinationDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending
}: AddDestinationDialogProps) {
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<ProviderKey>("s3");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [endpointVal, setEndpointVal] = useState("");
  const [s3Provider, setS3Provider] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [rcloneConfig, setRcloneConfig] = useState("");
  const [rcloneRemotePath, setRcloneRemotePath] = useState("");

  function handleSubmit() {
    onSubmit({
      name,
      provider,
      accessKey: provider === "s3" ? accessKey : undefined,
      secretAccessKey: provider === "s3" ? secretKey : undefined,
      bucket: provider === "s3" ? bucket : undefined,
      region: provider === "s3" ? region : undefined,
      endpoint: provider === "s3" ? endpointVal : undefined,
      s3Provider: provider === "s3" ? s3Provider : undefined,
      localPath: provider === "local" ? localPath : undefined,
      rcloneConfig:
        provider === "rclone" || provider === "sftp" ? rcloneConfig : undefined,
      rcloneRemotePath:
        provider === "rclone" || provider === "sftp" ? rcloneRemotePath : undefined,
      oauthToken:
        provider === "gdrive" || provider === "onedrive" || provider === "dropbox"
          ? rcloneConfig
          : undefined
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button data-testid="destination-add-button">
          <Plus size={16} /> Add Destination
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-xl" data-testid="destination-dialog">
        <DialogHeader>
          <DialogTitle>Add Backup Destination</DialogTitle>
          <DialogDescription>
            Configure a new storage target for backups. Test connectivity before saving.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-1.5">
            <Label htmlFor="dest-name">Name</Label>
            <Input
              id="dest-name"
              placeholder="My S3 Bucket"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="grid gap-1.5">
            <Label>Provider</Label>
            <Select
              value={provider}
              onValueChange={(v: string) => setProvider(v as ProviderKey)}
            >
              <SelectTrigger data-testid="destination-provider-select">
                <SelectValue placeholder="Select provider" />
              </SelectTrigger>
              <SelectContent>
                {PROVIDERS.map((p) => (
                  <SelectItem key={p.key} value={p.key}>
                    {p.icon} {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {provider === "s3" && <S3Fields
            s3Provider={s3Provider} setS3Provider={setS3Provider}
            accessKey={accessKey} setAccessKey={setAccessKey}
            secretKey={secretKey} setSecretKey={setSecretKey}
            bucket={bucket} setBucket={setBucket}
            region={region} setRegion={setRegion}
            endpoint={endpointVal} setEndpoint={setEndpointVal}
          />}

          {provider === "local" && (
            <div className="grid gap-1.5">
              <Label>Local Path</Label>
              <Input
                data-testid="destination-local-path"
                placeholder="/tmp/daoflow-backups"
                value={localPath}
                onChange={(e) => setLocalPath(e.target.value)}
              />
            </div>
          )}

          {(provider === "gdrive" || provider === "onedrive" || provider === "dropbox") && (
            <div className="grid gap-1.5">
              <Label>OAuth Token (from rclone authorize)</Label>
              <Textarea
                className="font-mono text-xs"
                placeholder="Paste the JSON token from rclone authorize..."
                rows={4}
                value={rcloneConfig}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                  setRcloneConfig(e.target.value)
                }
              />
            </div>
          )}

          {(provider === "rclone" || provider === "sftp") && (
            <>
              <div className="grid gap-1.5">
                <Label>Rclone Config (INI format)</Label>
                <Textarea
                  className="font-mono text-xs"
                  placeholder={"[remote]\ntype = sftp\nhost = backup.example.com\nuser = admin"}
                  rows={4}
                  value={rcloneConfig}
                  onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) =>
                    setRcloneConfig(e.target.value)
                  }
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Remote Path</Label>
                <Input
                  placeholder="backups/daoflow"
                  value={rcloneRemotePath}
                  onChange={(e) => setRcloneRemotePath(e.target.value)}
                />
              </div>
            </>
          )}
        </div>

        <DialogFooter>
          <Button
            data-testid="destination-create-button"
            variant="outline"
            disabled={isPending}
            onClick={handleSubmit}
          >
            {isPending ? "Creating…" : "Create Destination"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function S3Fields({
  s3Provider, setS3Provider,
  accessKey, setAccessKey,
  secretKey, setSecretKey,
  bucket, setBucket,
  region, setRegion,
  endpoint, setEndpoint
}: {
  s3Provider: string; setS3Provider: (v: string) => void;
  accessKey: string; setAccessKey: (v: string) => void;
  secretKey: string; setSecretKey: (v: string) => void;
  bucket: string; setBucket: (v: string) => void;
  region: string; setRegion: (v: string) => void;
  endpoint: string; setEndpoint: (v: string) => void;
}) {
  return (
    <>
      <div className="grid gap-1.5">
        <Label>S3 Provider</Label>
        <Select value={s3Provider} onValueChange={setS3Provider}>
          <SelectTrigger>
            <SelectValue placeholder="Select S3 provider" />
          </SelectTrigger>
          <SelectContent>
            {S3_SUB_PROVIDERS.map((sp) => (
              <SelectItem key={sp.key} value={sp.key}>
                {sp.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Access Key</Label>
          <Input placeholder="AKIAIOSFODNN7" value={accessKey} onChange={(e) => setAccessKey(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Secret Key</Label>
          <Input type="password" placeholder="wJalrXUtnFEMI/K7" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label>Bucket</Label>
          <Input placeholder="my-backups" value={bucket} onChange={(e) => setBucket(e.target.value)} />
        </div>
        <div className="grid gap-1.5">
          <Label>Region</Label>
          <Input placeholder="us-east-1" value={region} onChange={(e) => setRegion(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label>Endpoint</Label>
        <Input placeholder="https://s3.amazonaws.com" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} />
      </div>
    </>
  );
}
