import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";

interface SecuritySettingsTabProps {
  isLoading: boolean;
  auditEntries: Record<string, unknown>[];
}

export function SecuritySettingsTab({ isLoading, auditEntries }: SecuritySettingsTabProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Security & Audit</CardTitle>
          <CardDescription>Recent audit trail and security events.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : auditEntries.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No audit entries recorded yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Action</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Resource</TableHead>
                  <TableHead>Outcome</TableHead>
                  <TableHead>Time</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {auditEntries.map((entry, i) => {
                  const id = String(entry["id"] ?? i);
                  const action = String(entry["action"] ?? "—");
                  const actor = String(
                    entry["actorEmail"] ?? entry["actorId"] ?? "—"
                  );
                  const resource = String(entry["resourceType"] ?? "—");
                  const outcome = String(entry["outcome"] ?? "—");
                  const created = entry["createdAt"]
                    ? new Date(String(entry["createdAt"])).toLocaleString()
                    : "—";
                  return (
                    <TableRow key={id}>
                      <TableCell className="font-medium">{action}</TableCell>
                      <TableCell className="text-muted-foreground">{actor}</TableCell>
                      <TableCell className="text-muted-foreground">{resource}</TableCell>
                      <TableCell>
                        <Badge variant={outcome === "success" ? "default" : "destructive"}>
                          {outcome}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">{created}</TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
