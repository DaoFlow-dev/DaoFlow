import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { FolderOpen, TestTube2, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";

interface Destination {
  id: string;
  name: string;
  provider: string;
  bucket?: string | null;
  region?: string | null;
  localPath?: string | null;
  rcloneRemotePath?: string | null;
  lastTestResult?: string | null;
  lastTestedAt?: string | null;
}

interface DestinationsTableProps {
  destinations: Destination[];
  onTest: (id: string) => void;
  onDelete: (id: string, name: string) => void;
  isTestPending: boolean;
  isDeletePending: boolean;
}

export function DestinationsTable({
  destinations,
  onTest,
  onDelete,
  isTestPending,
  isDeletePending
}: DestinationsTableProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Destinations</CardTitle>
        <CardDescription>{destinations.length} configured</CardDescription>
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
            {destinations.map((d) => (
              <TableRow key={d.id} data-testid="destination-row">
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
                  {d.lastTestedAt && (
                    <span className="ml-1 text-xs text-muted-foreground">
                      {new Date(d.lastTestedAt).toLocaleDateString()}
                    </span>
                  )}
                </TableCell>
                <TableCell className="text-right space-x-1">
                  <Link
                    to={`/destinations/${d.id}/browse`}
                    className="inline-flex items-center justify-center h-8 w-8 rounded-md hover:bg-accent hover:text-accent-foreground"
                    title="Browse Files"
                  >
                    <FolderOpen size={14} />
                  </Link>
                  <Button
                    data-testid="destination-test-button"
                    size="icon"
                    variant="ghost"
                    title="Test Connection"
                    disabled={isTestPending}
                    onClick={() => onTest(d.id)}
                  >
                    <TestTube2 size={14} />
                  </Button>
                  <Button
                    data-testid="destination-delete-button"
                    size="icon"
                    variant="ghost"
                    title="Delete"
                    disabled={isDeletePending}
                    onClick={() => {
                      if (confirm(`Delete destination "${d.name}"?`)) {
                        onDelete(d.id, d.name);
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
  );
}
