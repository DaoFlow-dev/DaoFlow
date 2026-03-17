import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { normalizeAppRole, canAssumeAnyRole, roleCapabilities } from "@daoflow/shared";
import { useSearchParams } from "react-router-dom";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from "@/components/ui/table";
import { Settings, Users, KeyRound, Shield, Bell, HardDrive, GitBranch, Lock } from "lucide-react";
import GitProvidersTab from "@/components/GitProvidersTab";
import SecretProvidersTab from "@/components/SecretProvidersTab";
import { NotificationPreferencesPanel } from "@/components/NotificationPreferencesPanel";

const SETTINGS_TABS = [
  "general",
  "users",
  "tokens",
  "security",
  "notifications",
  "volumes",
  "git",
  "secrets"
] as const;

export default function SettingsPage() {
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const tokens = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const principals = trpc.principalInventory.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const audit = trpc.auditTrail.useQuery({ limit: 20 }, { enabled: Boolean(session.data) });

  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "viewer";
  const isAdmin = canAssumeAnyRole(currentRole, ["owner", "admin"]);
  const caps = viewer.data ? roleCapabilities[currentRole] : [];
  const requestedTab = searchParams.get("tab");
  const activeTab =
    requestedTab && SETTINGS_TABS.includes(requestedTab as (typeof SETTINGS_TABS)[number])
      ? requestedTab
      : "general";

  return (
    <main className="shell space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          General configuration and platform settings.
        </p>
      </div>

      {!session.data ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <p className="text-sm text-muted-foreground">Sign in to access settings.</p>
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            const next = new URLSearchParams(searchParams);
            if (value === "general") {
              next.delete("tab");
            } else {
              next.set("tab", value);
            }
            setSearchParams(next, { replace: true });
          }}
          className="w-full"
        >
          <TabsList className="w-full justify-start">
            <TabsTrigger value="general" className="gap-1.5">
              <Settings size={14} /> General
            </TabsTrigger>
            <TabsTrigger value="users" className="gap-1.5">
              <Users size={14} /> Users
            </TabsTrigger>
            <TabsTrigger value="tokens" className="gap-1.5">
              <KeyRound size={14} /> Tokens
            </TabsTrigger>
            <TabsTrigger value="security" className="gap-1.5">
              <Shield size={14} /> Security
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell size={14} /> Notifications
            </TabsTrigger>
            <TabsTrigger value="volumes" className="gap-1.5">
              <HardDrive size={14} /> Volumes
            </TabsTrigger>
            <TabsTrigger value="git" className="gap-1.5">
              <GitBranch size={14} /> Git Providers
            </TabsTrigger>
            <TabsTrigger value="secrets" className="gap-1.5">
              <Lock size={14} /> Secret Providers
            </TabsTrigger>
          </TabsList>

          {/* ── General ───────────────────────────────────── */}
          {activeTab === "general" && (
            <div className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">General Settings</CardTitle>
                  <CardDescription>Platform information and system status.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Platform</p>
                      <p className="text-sm font-medium">DaoFlow v0.1.0</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Your Role</p>
                      <p className="text-sm font-medium capitalize">{currentRole}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Email</p>
                      <p className="text-sm font-medium">{viewer.data?.user.email ?? "—"}</p>
                    </div>
                    <div className="rounded-lg border p-3">
                      <p className="text-xs text-muted-foreground">Session Expires</p>
                      <p className="text-sm font-medium">
                        {viewer.data?.session.expiresAt
                          ? new Date(viewer.data.session.expiresAt).toLocaleString()
                          : "—"}
                      </p>
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-xs text-muted-foreground">
                      Granted Scopes ({caps.length})
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {caps.map((scope) => (
                        <Badge key={scope} variant="secondary" className="text-xs">
                          {scope}
                        </Badge>
                      ))}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Users ─────────────────────────────────────── */}
          {activeTab === "users" && (
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
                  {principals.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : !principals.data || principals.data.principals.length === 0 ? (
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
                        {principals.data.principals.map((p) => (
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
          )}

          {/* ── Tokens ────────────────────────────────────── */}
          {activeTab === "tokens" && (
            <div className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">API Tokens</CardTitle>
                  <CardDescription>
                    Scoped API tokens for integrations and agent access.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {tokens.isLoading ? (
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
                  ) : !tokens.data || tokens.data.tokens.length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      No API tokens created yet.
                    </p>
                  ) : (
                    <>
                      <div className="mb-4 grid gap-3 sm:grid-cols-3">
                        <div className="rounded-lg border p-3 text-center">
                          <p className="text-lg font-bold">{tokens.data.summary.totalTokens}</p>
                          <p className="text-xs text-muted-foreground">Total</p>
                        </div>
                        <div className="rounded-lg border p-3 text-center">
                          <p className="text-lg font-bold">{tokens.data.summary.readOnlyTokens}</p>
                          <p className="text-xs text-muted-foreground">Read-only</p>
                        </div>
                        <div className="rounded-lg border p-3 text-center">
                          <p className="text-lg font-bold">{tokens.data.summary.commandTokens}</p>
                          <p className="text-xs text-muted-foreground">Command</p>
                        </div>
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
                          {tokens.data.tokens.map((t) => (
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
          )}

          {/* ── Security & Audit ──────────────────────────── */}
          {activeTab === "security" && (
            <div className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Security & Audit</CardTitle>
                  <CardDescription>Recent audit trail and security events.</CardDescription>
                </CardHeader>
                <CardContent>
                  {audit.isLoading ? (
                    <div className="space-y-2">
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                      <Skeleton className="h-8 w-full" />
                    </div>
                  ) : !audit.data || (Array.isArray(audit.data) && audit.data.length === 0) ? (
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
                        {(Array.isArray(audit.data) ? audit.data : []).map(
                          /* eslint-disable @typescript-eslint/no-base-to-string */
                          (entry: Record<string, unknown>, i: number) => {
                            const id = String(entry["id"] ?? i);
                            const action = String(entry["action"] ?? "—");
                            const actor = String(entry["actorEmail"] ?? entry["actorId"] ?? "—");
                            const resource = String(entry["resourceType"] ?? "—");
                            const outcome = String(entry["outcome"] ?? "—");
                            const created = entry["createdAt"]
                              ? new Date(String(entry["createdAt"])).toLocaleString()
                              : "—";
                            /* eslint-enable @typescript-eslint/no-base-to-string */
                            return (
                              <TableRow key={id}>
                                <TableCell className="font-medium">{action}</TableCell>
                                <TableCell className="text-muted-foreground">{actor}</TableCell>
                                <TableCell className="text-muted-foreground">{resource}</TableCell>
                                <TableCell>
                                  <Badge
                                    variant={outcome === "success" ? "default" : "destructive"}
                                  >
                                    {outcome}
                                  </Badge>
                                </TableCell>
                                <TableCell className="text-muted-foreground">{created}</TableCell>
                              </TableRow>
                            );
                          }
                        )}
                      </TableBody>
                    </Table>
                  )}
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Notifications ─────────────────────────────── */}
          {activeTab === "notifications" && (
            <div className="mt-4">
              <NotificationPreferencesPanel />
            </div>
          )}

          {/* ── Volumes ───────────────────────────────────── */}
          {activeTab === "volumes" && (
            <div className="mt-4">
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Persistent Volumes</CardTitle>
                  <CardDescription>Manage named volumes and storage configuration.</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    Volume management coming in Milestone 8.
                  </p>
                </CardContent>
              </Card>
            </div>
          )}

          {/* ── Git Providers ──────────────────────────────── */}
          {activeTab === "git" && (
            <div className="mt-4">
              <GitProvidersTab />
            </div>
          )}

          {/* ── Secret Providers (1Password) ───────────────── */}
          {activeTab === "secrets" && (
            <div className="mt-4">
              <SecretProvidersTab />
            </div>
          )}
        </Tabs>
      )}
    </main>
  );
}
