import { useSession } from "../lib/auth-client";
import { trpc } from "../lib/trpc";
import { normalizeAppRole, canAssumeAnyRole, type AppRole } from "@daoflow/shared";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Settings, Users, KeyRound, Shield, Bell, HardDrive } from "lucide-react";

export default function SettingsPage() {
  const session = useSession();
  const viewer = trpc.viewer.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const currentRole = viewer.data ? normalizeAppRole(viewer.data.authz.role) : "guest";
  const isAdmin = canAssumeAnyRole(currentRole as AppRole, ["owner", "admin"]);

  const settingsSections = [
    {
      id: "general",
      label: "General",
      icon: Settings,
      title: "General Settings",
      desc: "Platform name, version, and system information."
    },
    {
      id: "users",
      label: "Users",
      icon: Users,
      title: "Users & Roles",
      desc: "Manage team members, roles, and permissions.",
      adminOnly: true
    },
    {
      id: "tokens",
      label: "Tokens",
      icon: KeyRound,
      title: "API Tokens",
      desc: "Create and manage scoped API tokens for integrations and agents."
    },
    {
      id: "security",
      label: "Security",
      icon: Shield,
      title: "Security & Audit",
      desc: "Audit log, session management, and security policies."
    },
    {
      id: "notifications",
      label: "Notifications",
      icon: Bell,
      title: "Notifications",
      desc: "Configure alerts and notification channels."
    },
    {
      id: "volumes",
      label: "Volumes",
      icon: HardDrive,
      title: "Persistent Volumes",
      desc: "Manage named volumes and storage configuration."
    }
  ];

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
        <Tabs defaultValue="general" className="w-full">
          <TabsList className="w-full justify-start">
            {settingsSections.map((s) => (
              <TabsTrigger key={s.id} value={s.id} className="gap-1.5">
                <s.icon size={14} />
                {s.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {settingsSections.map((s) => (
            <TabsContent key={s.id} value={s.id} className="mt-4">
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <CardTitle className="text-base">{s.title}</CardTitle>
                    {s.adminOnly && !isAdmin && <Badge variant="secondary">Admin only</Badge>}
                  </div>
                  <CardDescription>{s.desc}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">
                    This section is under development. Configure {s.label.toLowerCase()} settings
                    here.
                  </p>
                </CardContent>
              </Card>
            </TabsContent>
          ))}
        </Tabs>
      )}
    </main>
  );
}
