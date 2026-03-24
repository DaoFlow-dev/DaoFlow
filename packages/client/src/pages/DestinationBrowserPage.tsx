import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { ArrowLeft, File, Folder, HardDrive } from "lucide-react";
import { useState } from "react";
import { useParams, Link } from "react-router-dom";

function formatBytes(bytes: number): string {
  if (bytes === 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0)} ${units[i]}`;
}

export default function DestinationBrowserPage() {
  const { id } = useParams<{ id: string }>();
  const session = useSession();
  const [currentPath, setCurrentPath] = useState<string | undefined>(undefined);

  const destination = trpc.backupDestination.useQuery(
    { destinationId: id ?? "" },
    { enabled: Boolean(session.data) && Boolean(id) }
  );

  const files = trpc.listDestinationFiles.useQuery(
    { id: id ?? "", path: currentPath },
    { enabled: Boolean(session.data) && Boolean(id) }
  );

  const pathParts = currentPath?.split("/").filter(Boolean) ?? [];

  function navigateUp() {
    if (pathParts.length <= 1) {
      setCurrentPath(undefined);
    } else {
      setCurrentPath(pathParts.slice(0, -1).join("/"));
    }
  }

  return (
    <main className="shell space-y-6">
      <div className="flex items-center gap-3">
        <Link
          to="/destinations"
          className="inline-flex items-center justify-center h-9 w-9 rounded-md border border-input bg-background text-sm hover:bg-accent hover:text-accent-foreground"
        >
          <ArrowLeft size={18} />
        </Link>
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">
            {destination.data?.name ?? "Destination"} — Files
          </h1>
          <div className="flex items-center gap-2 mt-1">
            {destination.data && <Badge variant="secondary">{destination.data.provider}</Badge>}
            {currentPath && (
              <span className="text-sm text-muted-foreground font-mono">/{currentPath}</span>
            )}
          </div>
        </div>
      </div>

      {currentPath && (
        <Button variant="outline" size="sm" onClick={navigateUp}>
          ↑ Up one level
        </Button>
      )}

      {files.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : files.data && !files.data.success ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-sm text-destructive">
              {files.data.error ?? "Failed to list files."}
            </p>
            <p className="text-xs text-muted-foreground mt-2">
              Make sure rclone is installed and the destination is properly configured.
            </p>
          </CardContent>
        </Card>
      ) : files.data?.files.length === 0 ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <HardDrive size={28} className="text-primary/50" />
          </div>
          <div>
            <p className="text-sm font-medium text-foreground">No files found</p>
            <p className="mt-1 text-sm text-muted-foreground">
              This destination is empty or the path does not exist.
            </p>
          </div>
        </div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{files.data?.files.length ?? 0} items</CardTitle>
          </CardHeader>
          <CardContent>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead className="w-24 text-right">Size</TableHead>
                  <TableHead className="w-44">Modified</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {files.data?.files
                  .sort((a, b) => {
                    if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
                    return a.name.localeCompare(b.name);
                  })
                  .map((f) => (
                    <TableRow key={f.path}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          {f.isDir ? (
                            <Folder size={16} className="text-amber-500 shrink-0" />
                          ) : (
                            <File size={16} className="text-muted-foreground shrink-0" />
                          )}
                          {f.isDir ? (
                            <button
                              className="text-left hover:underline text-sm font-medium"
                              onClick={() =>
                                setCurrentPath(currentPath ? `${currentPath}/${f.name}` : f.name)
                              }
                            >
                              {f.name}/
                            </button>
                          ) : (
                            <span className="text-sm">{f.name}</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="text-right text-sm text-muted-foreground">
                        {f.isDir ? "—" : formatBytes(f.size)}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {f.modTime
                          ? new Date(f.modTime).toLocaleString(undefined, {
                              dateStyle: "medium",
                              timeStyle: "short"
                            })
                          : "—"}
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
