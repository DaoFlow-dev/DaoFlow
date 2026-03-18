import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { normalizeAppRole, canAssumeAnyRole, roleCapabilities } from "@daoflow/shared";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Users, KeyRound, Shield, Bell, HardDrive, GitBranch, Lock } from "lucide-react";
import GitProvidersTab from "@/components/GitProvidersTab";
import SecretProvidersTab from "@/components/SecretProvidersTab";
import { NotificationPreferencesPanel } from "@/components/NotificationPreferencesPanel";
import { GeneralSettingsTab } from "@/components/settings/GeneralSettingsTab";
import { UsersSettingsTab } from "@/components/settings/UsersSettingsTab";
import { TokensSettingsTab } from "@/components/settings/TokensSettingsTab";
import { SecuritySettingsTab } from "@/components/settings/SecuritySettingsTab";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

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
    <main className="shell space-y-6" data-testid="settings-page">
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
          <div className="mt-4" role="tabpanel" aria-live="polite">
            {activeTab === "general" && (
              <GeneralSettingsTab
                currentRole={currentRole}
                email={viewer.data?.user.email}
                sessionExpiresAt={viewer.data?.session.expiresAt}
                caps={caps}
              />
            )}

            {activeTab === "users" && (
              <UsersSettingsTab
                isAdmin={isAdmin}
                isLoading={principals.isLoading}
                principals={principals.data?.principals ?? []}
              />
            )}

            {activeTab === "tokens" && (
              <TokensSettingsTab
                isLoading={tokens.isLoading}
                tokens={tokens.data?.tokens ?? []}
                summary={tokens.data?.summary ?? null}
              />
            )}

            {activeTab === "security" && (
              <SecuritySettingsTab
                isLoading={audit.isLoading}
                auditEntries={
                  Array.isArray(audit.data) ? (audit.data as Record<string, unknown>[]) : []
                }
              />
            )}

            {activeTab === "notifications" && (
              <div className="mt-4">
                <NotificationPreferencesPanel />
              </div>
            )}

            {activeTab === "volumes" && (
              <div className="mt-4">
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">Persistent Volumes</CardTitle>
                    <CardDescription>
                      Manage named volumes and storage configuration.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">
                      Volume management coming in Milestone 8.
                    </p>
                  </CardContent>
                </Card>
              </div>
            )}

            {activeTab === "git" && (
              <div className="mt-4">
                <GitProvidersTab />
              </div>
            )}

            {activeTab === "secrets" && (
              <div className="mt-4">
                <SecretProvidersTab />
              </div>
            )}
          </div>
        </Tabs>
      )}
    </main>
  );
}
