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

interface Principal {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: string;
}

interface UsersSettingsTabProps {
  isAdmin: boolean;
  isLoading: boolean;
  principals: Principal[];
}

export function UsersSettingsTab({ isAdmin, isLoading, principals }: UsersSettingsTabProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <CardTitle className="text-base">Users & Principals</CardTitle>
            {!isAdmin && <Badge variant="secondary">Admin only</Badge>}
          </div>
          <CardDescription>
            Team members, service accounts, and agent principals.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-8 w-full" />
              <Skeleton className="h-8 w-full" />
            </div>
          ) : principals.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No principals registered.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {principals.map((p) => (
                  <TableRow key={p.id}>
                    <TableCell className="font-medium">{p.name}</TableCell>
                    <TableCell>
                      <Badge variant={p.type === "agent" ? "outline" : "secondary"}>
                        {p.type}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Badge variant={p.status === "active" ? "default" : "destructive"}>
                        {p.status}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {new Date(p.createdAt).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
