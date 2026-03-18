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

interface Token {
  id: string;
  name: string;
  principalKind: string;
  lanes: string[];
  status: string;
  createdAt: string;
}

interface TokenSummary {
  totalTokens: number;
  readOnlyTokens: number;
  commandTokens: number;
}

interface TokensSettingsTabProps {
  isLoading: boolean;
  tokens: Token[];
  summary: TokenSummary | null;
}

export function TokensSettingsTab({ isLoading, tokens, summary }: TokensSettingsTabProps) {
  return (
    <div className="mt-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">API Tokens</CardTitle>
          <CardDescription>Scoped API tokens for integrations and agent access.</CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <TokensSkeleton />
          ) : tokens.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              No API tokens created yet.
            </p>
          ) : (
            <>
              {summary && (
                <div className="mb-4 grid gap-3 sm:grid-cols-3">
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold">{summary.totalTokens}</p>
                    <p className="text-xs text-muted-foreground">Total</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold">{summary.readOnlyTokens}</p>
                    <p className="text-xs text-muted-foreground">Read-only</p>
                  </div>
                  <div className="rounded-lg border p-3 text-center">
                    <p className="text-lg font-bold">{summary.commandTokens}</p>
                    <p className="text-xs text-muted-foreground">Command</p>
                  </div>
                </div>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Principal</TableHead>
                    <TableHead>Lanes</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Created</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tokens.map((t) => (
                    <TableRow key={t.id}>
                      <TableCell className="font-medium">{t.name}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{t.principalKind}</Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {t.lanes.map((lane) => (
                            <Badge
                              key={lane}
                              variant={
                                lane === "command"
                                  ? "destructive"
                                  : lane === "planning"
                                    ? "secondary"
                                    : "default"
                              }
                              className="text-xs"
                            >
                              {lane}
                            </Badge>
                          ))}
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant={t.status === "active" ? "default" : "secondary"}>
                          {t.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {new Date(t.createdAt).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function TokensSkeleton() {
  return (
    <>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Name</TableHead>
            <TableHead>Principal</TableHead>
            <TableHead>Lanes</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Created</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {Array.from({ length: 3 }).map((_, index) => (
            <TableRow key={index}>
              <TableCell colSpan={5}>
                <Skeleton className="h-8 w-full" />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </>
  );
}
