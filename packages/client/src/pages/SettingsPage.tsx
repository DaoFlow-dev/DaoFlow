import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { normalizeAppRole, canAssumeAnyRole } from "@daoflow/shared";
import { useSearchParams } from "react-router-dom";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Settings,
  Users,
  KeyRound,
  Shield,
  Bell,
  HardDrive,
  GitBranch,
  Lock,
  Boxes,
  Network
} from "lucide-react";
import GitProvidersTab from "@/components/GitProvidersTab";
import SecretProvidersTab from "@/components/SecretProvidersTab";
import { NotificationPreferencesPanel } from "@/components/NotificationPreferencesPanel";
import { ContainerRegistriesPanel } from "@/components/settings/ContainerRegistriesPanel";
import { GeneralSettingsTab } from "@/components/settings/GeneralSettingsTab";
import { UsersSettingsTab } from "@/components/settings/UsersSettingsTab";
import { TokensSettingsTab } from "@/components/settings/TokensSettingsTab";
import { SecuritySettingsTab } from "@/components/settings/SecuritySettingsTab";
import { VolumeRegistryPanel } from "@/components/settings/VolumeRegistryPanel";
import { ManagedOperationsPanel } from "@/components/settings/ManagedOperationsPanel";
import { useState } from "react";

const SETTINGS_TABS = [
  "general",
  "users",
  "tokens",
  "security",
  "notifications",
  "volumes",
  "operations",
  "registries",
  "git",
  "secrets"
] as const;

type SettingsTab = (typeof SETTINGS_TABS)[number];

function isSettingsTab(value: unknown): value is SettingsTab {
  return typeof value === "string" && SETTINGS_TABS.includes(value as SettingsTab);
}

export default function SettingsPage() {
  const utils = trpc.useUtils();
  const session = useSession();
  const [searchParams, setSearchParams] = useSearchParams();
  const [maintenanceFeedback, setMaintenanceFeedback] = useState<string | null>(null);
  const [userFeedback, setUserFeedback] = useState<string | null>(null);
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "viewer";
  const isAdmin = canAssumeAnyRole(currentRole, ["owner", "admin"]);
  const caps = viewer.data?.authz.capabilities ?? [];
  const canManageMembers = isAdmin && caps.includes("members:manage");
  const canManageTokens = isAdmin && caps.includes("tokens:manage");
  const canManageAdminServerSettings = isAdmin && caps.includes("server:write");
  const canManageIntegrations = isAdmin;
  const tokens = trpc.agentTokenInventory.useQuery(undefined, {
    enabled: Boolean(session.data) && canManageTokens
  });
  const principals = trpc.principalInventory.useQuery(undefined, {
    enabled: Boolean(session.data) && canManageMembers
  });
  const audit = trpc.auditTrail.useQuery({ limit: 20 }, { enabled: Boolean(session.data) });
  const accountSecurity = trpc.accountSecurityStatus.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const maintenanceReport = trpc.operationalMaintenanceReport.useQuery(undefined, {
    enabled: Boolean(session.data) && canManageAdminServerSettings
  });
  const runOperationalMaintenance = trpc.runOperationalMaintenance.useMutation({
    onSuccess: async (result) => {
      setMaintenanceFeedback(result.summary);
      await Promise.all([maintenanceReport.refetch(), audit.refetch()]);
    },
    onError: (error) => {
      setMaintenanceFeedback(error.message);
    }
  });
  const inviteUser = trpc.inviteUser.useMutation({
    onSuccess: async (invite) => {
      await utils.principalInventory.invalidate();
      setUserFeedback(
        `Invite ready for ${invite.email}. They can sign up with that email before ${new Date(invite.expiresAt).toLocaleDateString()}.`
      );
    },
    onError: (error) => {
      setUserFeedback(error.message);
    }
  });
  const updateAccountSecurityPolicy = trpc.updateAccountSecurityPolicy.useMutation({
    onSuccess: async () => {
      await Promise.all([accountSecurity.refetch(), audit.refetch()]);
    }
  });
  const requestedTab = searchParams.get("tab");
  const availableTabs = new Set<SettingsTab>([
    "general",
    "security",
    "notifications",
    "volumes",
    ...(canManageMembers ? (["users"] as const) : []),
    ...(canManageTokens ? (["tokens"] as const) : []),
    ...(canManageAdminServerSettings ? (["operations", "registries"] as const) : []),
    ...(canManageIntegrations ? (["git", "secrets"] as const) : [])
  ]);
  const activeTab: SettingsTab =
    isSettingsTab(requestedTab) && availableTabs.has(requestedTab) ? requestedTab : "general";
  const auditEntries = audit.data?.entries ?? [];

  return (
    <main className="shell space-y-6" data-testid="settings-page">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          General configuration and platform settings.
        </p>
      </div>

      {!session.data ? (
        <div className="flex flex-col items-center gap-4 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
            <Settings size={28} className="text-primary/50" />
          </div>
          <p className="text-sm text-muted-foreground">Sign in to access settings.</p>
        </div>
      ) : (
        <Tabs
          value={activeTab}
          onValueChange={(value) => {
            if (!isSettingsTab(value)) {
              return;
            }
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
          <TabsList className="w-full justify-start overflow-x-auto">
            <TabsTrigger value="general" className="gap-1.5">
              <Settings size={14} /> General
            </TabsTrigger>
            {canManageMembers ? (
              <TabsTrigger value="users" className="gap-1.5">
                <Users size={14} /> Users
              </TabsTrigger>
            ) : null}
            {canManageTokens ? (
              <TabsTrigger value="tokens" className="gap-1.5">
                <KeyRound size={14} /> Tokens
              </TabsTrigger>
            ) : null}
            <TabsTrigger value="security" className="gap-1.5">
              <Shield size={14} /> Security
            </TabsTrigger>
            <TabsTrigger value="notifications" className="gap-1.5">
              <Bell size={14} /> Notifications
            </TabsTrigger>
            <TabsTrigger value="volumes" className="gap-1.5">
              <HardDrive size={14} /> Volumes
            </TabsTrigger>
            {canManageAdminServerSettings ? (
              <TabsTrigger value="operations" className="gap-1.5">
                <Network size={14} /> Operations
              </TabsTrigger>
            ) : null}
            {canManageAdminServerSettings ? (
              <TabsTrigger value="registries" className="gap-1.5">
                <Boxes size={14} /> Registries
              </TabsTrigger>
            ) : null}
            {canManageIntegrations ? (
              <>
                <TabsTrigger value="git" className="gap-1.5">
                  <GitBranch size={14} /> Git Providers
                </TabsTrigger>
                <TabsTrigger value="secrets" className="gap-1.5">
                  <Lock size={14} /> Secret Providers
                </TabsTrigger>
              </>
            ) : null}
          </TabsList>
          <div className="mt-6 min-h-[400px]" role="tabpanel" aria-live="polite">
            {activeTab === "general" && (
              <GeneralSettingsTab
                currentRole={currentRole}
                email={viewer.data?.principal.email}
                sessionExpiresAt={viewer.data?.session?.expiresAt}
                caps={caps}
                maintenanceReport={maintenanceReport.data ?? null}
                maintenanceLoading={maintenanceReport.isLoading}
                canManageMaintenance={canManageAdminServerSettings}
                maintenanceActionPending={runOperationalMaintenance.isPending}
                maintenanceFeedback={maintenanceFeedback}
                onRefreshMaintenance={() => {
                  setMaintenanceFeedback(null);
                  void maintenanceReport.refetch();
                }}
                onDryRunMaintenance={() => {
                  void runOperationalMaintenance.mutateAsync({ dryRun: true });
                }}
                onRunMaintenance={() => {
                  void runOperationalMaintenance.mutateAsync({ dryRun: false });
                }}
              />
            )}
            {activeTab === "users" && (
              <UsersSettingsTab
                isAdmin={isAdmin}
                isLoading={canManageMembers ? principals.isLoading : false}
                principals={principals.data?.principals ?? []}
                invites={principals.data?.invites ?? []}
                inviteStatus={inviteUser.status}
                feedback={userFeedback}
                onInvite={(input) => {
                  setUserFeedback(null);
                  inviteUser.mutate(input);
                }}
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
                isLoading={audit.isLoading || accountSecurity.isLoading}
                auditEntries={auditEntries}
                accountSecurity={accountSecurity.data ?? null}
                canManagePolicy={canManageMembers}
                policyPending={updateAccountSecurityPolicy.isPending}
                onPolicyChange={(mfaRequirement) => {
                  updateAccountSecurityPolicy.mutate({ mfaRequirement });
                }}
                onSecurityRefresh={() => {
                  void Promise.all([accountSecurity.refetch(), audit.refetch(), session.refetch()]);
                }}
              />
            )}

            {activeTab === "notifications" && (
              <div className="mt-4">
                <NotificationPreferencesPanel />
              </div>
            )}

            {activeTab === "volumes" && (
              <div className="mt-4">
                <VolumeRegistryPanel canManage={caps.includes("volumes:write")} />
              </div>
            )}

            {activeTab === "operations" && (
              <div className="mt-4">
                <ManagedOperationsPanel canManage={canManageAdminServerSettings} />
              </div>
            )}

            {activeTab === "registries" && (
              <div className="mt-4">
                <ContainerRegistriesPanel canManage={canManageAdminServerSettings} />
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
