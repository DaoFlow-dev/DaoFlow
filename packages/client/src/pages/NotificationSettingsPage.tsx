/**
 * Task #67: Notification settings UI — user-level + project overrides.
 * Task #68: Notification dashboard widget.
 * Wired to tRPC: getUserPreferences, setUserPreference, getProjectOverrides,
 * setProjectOverride, listDeliveryLogs, projects.
 */
import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";

const CHANNEL_TYPES = ["web_push", "email", "slack", "discord", "generic_webhook"] as const;
const CHANNEL_LABELS: Record<string, string> = {
  web_push: "Push",
  email: "Email",
  slack: "Slack",
  discord: "Discord",
  generic_webhook: "Webhook"
};
const EVENT_DOMAINS = [
  { key: "backup.*", label: "Backup" },
  { key: "deploy.*", label: "Deploy" },
  { key: "server.*", label: "Server" },
  { key: "security.*", label: "Security" }
];

type Tab = "user" | "project" | "activity";

export default function NotificationSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("user");

  return (
    <div className="max-w-4xl mx-auto" data-testid="notification-settings-page">
      <h1 className="text-2xl font-bold text-white mb-2">Notification Settings</h1>
      <p className="text-white/50 text-sm mb-6">
        Control which notifications you receive and how they&apos;re delivered
      </p>

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-white/5 rounded-lg p-1 w-fit">
        {(["user", "project", "activity"] as Tab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
              activeTab === tab ? "bg-white/10 text-white" : "text-white/50 hover:text-white/70"
            }`}
          >
            {tab === "user"
              ? "User Defaults"
              : tab === "project"
                ? "Project Overrides"
                : "Activity Log"}
          </button>
        ))}
      </div>

      {activeTab === "user" && <UserDefaultsTab />}
      {activeTab === "project" && <ProjectOverridesTab />}
      {activeTab === "activity" && <ActivityLogTab />}
    </div>
  );
}

function UserDefaultsTab() {
  const session = useSession();
  const prefsQuery = trpc.getUserPreferences.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const setPref = trpc.setUserPreference.useMutation({
    onSuccess: () => void prefsQuery.refetch()
  });

  // Build a lookup: `${eventType}::${channelType}` -> enabled
  const prefMap = new Map<string, boolean>();
  for (const p of prefsQuery.data ?? []) {
    prefMap.set(`${p.eventType}::${p.channelType}`, p.enabled);
  }

  const isEnabled = (domain: string, channel: string) =>
    prefMap.get(`${domain}::${channel}`) ?? true;

  const toggle = (domain: string, channel: string) => {
    const current = isEnabled(domain, channel);
    setPref.mutate({ eventType: domain, channelType: channel, enabled: !current });
  };

  return (
    <div className="space-y-4" data-testid="user-defaults-tab">
      <p className="text-xs text-white/40 mb-4">
        Set your default notification preferences. These apply to all projects unless overridden.
      </p>
      {prefsQuery.isLoading ? (
        <Skeleton className="h-40 w-full" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-xs text-white/40 uppercase tracking-wider">
                <th className="text-left py-2 px-3">Event</th>
                {CHANNEL_TYPES.map((ch) => (
                  <th key={ch} className="text-center py-2 px-3">
                    {CHANNEL_LABELS[ch]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {EVENT_DOMAINS.map(({ key, label }) => (
                <tr key={key} className="border-t border-white/5">
                  <td className="py-3 px-3 text-sm text-white/80">{label}</td>
                  {CHANNEL_TYPES.map((ch) => {
                    const enabled = isEnabled(key, ch);
                    return (
                      <td key={ch} className="text-center py-3 px-3">
                        <button
                          onClick={() => toggle(key, ch)}
                          disabled={setPref.isPending}
                          className={`w-8 h-5 rounded-full transition-colors ${
                            enabled ? "bg-emerald-500" : "bg-white/10"
                          }`}
                        >
                          <div
                            className={`w-3.5 h-3.5 rounded-full bg-white transition-transform ${
                              enabled ? "translate-x-3.5" : "translate-x-0.5"
                            }`}
                          />
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ProjectOverridesTab() {
  const session = useSession();
  const projectsQuery = trpc.projects.useQuery({ limit: 50 }, { enabled: Boolean(session.data) });
  const projects = projectsQuery.data ?? [];
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);

  // Auto-select first project when loaded
  const activeProjectId = selectedProjectId ?? projects[0]?.id ?? null;

  const overridesQuery = trpc.getProjectOverrides.useQuery(
    { projectId: activeProjectId ?? "" },
    { enabled: Boolean(activeProjectId) }
  );
  const setOverride = trpc.setProjectOverride.useMutation({
    onSuccess: () => void overridesQuery.refetch()
  });

  // Build lookup
  const overrideMap = new Map<string, boolean>();
  for (const o of overridesQuery.data ?? []) {
    overrideMap.set(`${o.eventType}::${o.channelType}`, o.enabled);
  }

  type TriState = "inherit" | "on" | "off";
  const getValue = (domain: string, channel: string): TriState => {
    const key = `${domain}::${channel}`;
    if (!overrideMap.has(key)) return "inherit";
    return overrideMap.get(key) ? "on" : "off";
  };

  const handleChange = (domain: string, channel: string, value: string) => {
    if (!activeProjectId) return;
    if (value === "inherit") {
      // TODO: Add deleteProjectOverride route to fully remove the override row
      // For now, setting to enabled=true is the closest to inherit behavior
      setOverride.mutate({
        projectId: activeProjectId,
        eventType: domain,
        channelType: channel,
        enabled: true
      });
      return;
    }
    setOverride.mutate({
      projectId: activeProjectId,
      eventType: domain,
      channelType: channel,
      enabled: value === "on"
    });
  };

  return (
    <div className="space-y-4" data-testid="project-overrides-tab">
      <p className="text-xs text-white/40 mb-4">
        Override notification settings for specific projects. Unset values inherit from user
        defaults.
      </p>

      {projectsQuery.isLoading ? (
        <Skeleton className="h-8 w-64" />
      ) : projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">No projects found.</p>
      ) : (
        <>
          {/* Project Selector */}
          <div className="flex gap-2 flex-wrap mb-4">
            {projects.map((proj) => (
              <Button
                key={proj.id}
                size="sm"
                variant={activeProjectId === proj.id ? "default" : "outline"}
                onClick={() => setSelectedProjectId(proj.id)}
              >
                {proj.name}
              </Button>
            ))}
          </div>

          {/* Override Grid */}
          <div className="space-y-2">
            {EVENT_DOMAINS.map(({ key, label }) => (
              <Card key={key}>
                <CardContent className="py-3 flex items-center justify-between">
                  <span className="text-sm text-white/80">{label}</span>
                  <div className="flex gap-3">
                    {CHANNEL_TYPES.map((ch) => (
                      <label key={ch} className="flex items-center gap-1 text-xs text-white/50">
                        <select
                          value={getValue(key, ch)}
                          onChange={(e: React.ChangeEvent<HTMLSelectElement>) =>
                            handleChange(key, ch, e.target.value)
                          }
                          className="bg-white/5 border border-white/10 rounded text-xs text-white/60 px-1 py-0.5"
                        >
                          <option value="inherit">inherit</option>
                          <option value="on">on</option>
                          <option value="off">off</option>
                        </select>
                        {CHANNEL_LABELS[ch]}
                      </label>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function ActivityLogTab() {
  const session = useSession();
  const logsQuery = trpc.listDeliveryLogs.useQuery(
    { limit: 20 },
    { enabled: Boolean(session.data) }
  );
  const logs = logsQuery.data ?? [];

  return (
    <div className="space-y-2" data-testid="activity-log-tab">
      <p className="text-xs text-white/40 mb-4">Recent notification delivery log</p>
      {logsQuery.isLoading ? (
        <div className="space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </div>
      ) : logs.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-8">
          No notification activity yet.
        </p>
      ) : (
        logs.map((log) => (
          <Card key={log.id}>
            <CardContent className="py-3 flex items-center gap-3">
              <div
                className={`w-2 h-2 rounded-full ${
                  log.status === "delivered" ? "bg-emerald-400" : "bg-red-400"
                }`}
              />
              <span className="text-sm text-white/80 flex-1">{log.eventType}</span>
              <Badge variant="secondary">{log.channelId}</Badge>
              <span className="text-xs text-white/30">{new Date(log.sentAt).toLocaleString()}</span>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
