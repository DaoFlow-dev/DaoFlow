import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
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
import { HardDrive, Plus, TestTube2, Trash2 } from "lucide-react";
import { useState } from "react";

// ── Provider constants (must match server) ──────────────
const PROVIDERS = [
  { key: "s3" as const, name: "S3-Compatible Storage", icon: "☁️" },
  { key: "gdrive" as const, name: "Google Drive", icon: "📁" },
  { key: "onedrive" as const, name: "Microsoft OneDrive", icon: "📂" },
  { key: "dropbox" as const, name: "Dropbox", icon: "📦" },
  { key: "sftp" as const, name: "SFTP / SSH", icon: "🔒" },
  { key: "local" as const, name: "Local Filesystem", icon: "💾" },
  { key: "rclone" as const, name: "Custom Rclone Config", icon: "⚙️" }
] as const;

type ProviderKey = (typeof PROVIDERS)[number]["key"];

const S3_SUB_PROVIDERS = [
  { key: "AWS", name: "Amazon Web Services (AWS) S3" },
  { key: "Cloudflare", name: "Cloudflare R2" },
  { key: "DigitalOcean", name: "DigitalOcean Spaces" },
  { key: "GCS", name: "Google Cloud Storage" },
  { key: "Minio", name: "MinIO" },
  { key: "Wasabi", name: "Wasabi" },
  { key: "Other", name: "Any S3-compatible provider" }
];

export default function DestinationsPage() {
  const session = useSession();
  const destinations = trpc.backupDestinations.useQuery({}, { enabled: Boolean(session.data) });
  const utils = trpc.useUtils();
  const [dialogOpen, setDialogOpen] = useState(false);

  // ── Form state ────────────────────────────────────────
  const [name, setName] = useState("");
  const [provider, setProvider] = useState<ProviderKey>("s3");
  const [accessKey, setAccessKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [bucket, setBucket] = useState("");
  const [region, setRegion] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [s3Provider, setS3Provider] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [rcloneConfig, setRcloneConfig] = useState("");
  const [rcloneRemotePath, setRcloneRemotePath] = useState("");

  const createMutation = trpc.createBackupDestination.useMutation({
    onSuccess: () => {
      void utils.backupDestinations.invalidate();
      setDialogOpen(false);
      resetForm();
    }
  });

  const testMutation = trpc.testBackupDestination.useMutation();
  const deleteMutation = trpc.deleteBackupDestination.useMutation({
    onSuccess: () => {
      void utils.backupDestinations.invalidate();
    }
  });

  function resetForm() {
    setName("");
    setProvider("s3");
    setAccessKey("");
    setSecretKey("");
    setBucket("");
    setRegion("");
    setEndpoint("");
    setS3Provider("");
    setLocalPath("");
    setRcloneConfig("");
    setRcloneRemotePath("");
  }

  const data = destinations.data ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Backup Destinations</h1>
          <p className="text-sm text-muted-foreground">
            Configure where backups are stored — S3, Google Drive, OneDrive, local, or any rclone
            remote.
          </p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} /> Add Destination
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-xl">
            <DialogHeader>
              <DialogTitle>Add Backup Destination</DialogTitle>
              <DialogDescription>
                Configure a new storage target for backups. Test connectivity before saving.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4 py-2">
              {/* Name */}
              <div className="grid gap-1.5">
                <Label htmlFor="dest-name">Name</Label>
                <Input
                  id="dest-name"
                  placeholder="My S3 Bucket"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              {/* Provider */}
              <div className="grid gap-1.5">
                <Label>Provider</Label>
                <Select value={provider} onValueChange={(v) => setProvider(v as ProviderKey)}>
                  <SelectTrigger>
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

              {/* S3 Fields */}
              {provider === "s3" && (
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
                      <Input
                        placeholder="AKIAIOSFODNN7"
                        value={accessKey}
                        onChange={(e) => setAccessKey(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Secret Key</Label>
                      <Input
                        type="password"
                        placeholder="wJalrXUtnFEMI/K7"
                        value={secretKey}
                        onChange={(e) => setSecretKey(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="grid gap-1.5">
                      <Label>Bucket</Label>
                      <Input
                        placeholder="my-backups"
                        value={bucket}
                        onChange={(e) => setBucket(e.target.value)}
                      />
                    </div>
                    <div className="grid gap-1.5">
                      <Label>Region</Label>
                      <Input
                        placeholder="us-east-1"
                        value={region}
                        onChange={(e) => setRegion(e.target.value)}
                      />
                    </div>
                  </div>
                  <div className="grid gap-1.5">
                    <Label>Endpoint</Label>
                    <Input
                      placeholder="https://s3.amazonaws.com"
                      value={endpoint}
                      onChange={(e) => setEndpoint(e.target.value)}
                    />
                  </div>
                </>
              )}

              {/* Local fields */}
              {provider === "local" && (
                <div className="grid gap-1.5">
                  <Label>Local Path</Label>
                  <Input
                    placeholder="/tmp/daoflow-backups"
                    value={localPath}
                    onChange={(e) => setLocalPath(e.target.value)}
                  />
                </div>
              )}

              {/* OAuth providers */}
              {(provider === "gdrive" || provider === "onedrive" || provider === "dropbox") && (
                <div className="grid gap-1.5">
                  <Label>OAuth Token (from rclone authorize)</Label>
                  <Textarea
                    className="font-mono text-xs"
                    placeholder="Paste the JSON token from rclone authorize..."
                    rows={4}
                    value={rcloneConfig}
                    onChange={(e) => setRcloneConfig(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Run <code>rclone authorize "{provider === "gdrive" ? "drive" : provider}"</code>{" "}
                    locally and paste the token here.
                  </p>
                </div>
              )}

              {/* Custom rclone */}
              {(provider === "rclone" || provider === "sftp") && (
                <>
                  <div className="grid gap-1.5">
                    <Label>Rclone Config (INI format)</Label>
                    <Textarea
                      className="font-mono text-xs"
                      placeholder={"[remote]\ntype = sftp\nhost = backup.example.com\nuser = admin"}
                      rows={4}
                      value={rcloneConfig}
                      onChange={(e) => setRcloneConfig(e.target.value)}
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
                variant="outline"
                disabled={createMutation.isPending}
                onClick={() => {
                  createMutation.mutate({
                    name,
                    provider,
                    accessKey: provider === "s3" ? accessKey : undefined,
                    secretAccessKey: provider === "s3" ? secretKey : undefined,
                    bucket: provider === "s3" ? bucket : undefined,
                    region: provider === "s3" ? region : undefined,
                    endpoint: provider === "s3" ? endpoint : undefined,
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
                }}
              >
                {createMutation.isPending ? "Creating…" : "Create Destination"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {destinations.isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-32 w-full" />
        </div>
      ) : data.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <HardDrive size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No backup destinations configured. Add a destination to start backing up your data.
          </p>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Destinations</CardTitle>
            <CardDescription>{data.length} configured</CardDescription>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Target</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell className="font-medium">{d.name}</TableCell>
                    <TableCell>
                      <Badge variant="secondary">{d.provider}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {d.provider === "s3"
                        ? `${d.bucket ?? ""}${d.region ? ` (${d.region})` : ""}`
                        : d.provider === "local"
                          ? (d.localPath ?? "")
                          : (d.rcloneRemotePath ?? "—")}
                    </TableCell>
                    <TableCell>
                      {d.lastTestResult === "success" ? (
                        <Badge variant="default">Connected</Badge>
                      ) : d.lastTestResult === "failed" ? (
                        <Badge variant="destructive">Failed</Badge>
                      ) : (
                        <Badge variant="outline">Untested</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right space-x-1">
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Test Connection"
                        disabled={testMutation.isPending}
                        onClick={() => testMutation.mutate({ id: d.id })}
                      >
                        <TestTube2 size={14} />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        title="Delete"
                        disabled={deleteMutation.isPending}
                        onClick={() => {
                          if (confirm(`Delete destination "${d.name}"?`)) {
                            deleteMutation.mutate({ id: d.id });
                          }
                        }}
                      >
                        <Trash2 size={14} />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </main>
  );
}
