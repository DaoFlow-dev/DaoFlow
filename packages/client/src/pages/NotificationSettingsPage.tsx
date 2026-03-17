/**
 * Task #67: Notification settings UI — user-level + project overrides.
 * Task #68: Notification dashboard widget.
 */
import { useState } from "react";

const CHANNEL_TYPES = ["push", "email", "slack", "discord", "webhook"] as const;
const EVENT_DOMAINS = [
  { key: "backup.*", label: "Backup" },
  { key: "deploy.*", label: "Deploy" },
  { key: "server.*", label: "Server" },
  { key: "security.*", label: "Security" },
  { key: "storage.*", label: "Storage" }
];

const MOCK_PROJECTS = [
  { id: "proj_1", name: "API Gateway" },
  { id: "proj_2", name: "Frontend App" },
  { id: "proj_3", name: "Analytics Service" }
];

type Tab = "user" | "project" | "activity";

export default function NotificationSettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>("user");
  const [selectedProject, setSelectedProject] = useState(MOCK_PROJECTS[0].id);

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
      {activeTab === "project" && (
        <ProjectOverridesTab
          selectedProject={selectedProject}
          onSelectProject={setSelectedProject}
        />
      )}
      {activeTab === "activity" && <ActivityLogTab />}
    </div>
  );
}

function UserDefaultsTab() {
  const [settings, setSettings] = useState<Record<string, Record<string, boolean>>>({});

  const toggle = (domain: string, channel: string) => {
    setSettings((prev) => ({
      ...prev,
      [domain]: { ...prev[domain], [channel]: !(prev[domain]?.[channel] ?? true) }
    }));
  };

  return (
    <div className="space-y-4" data-testid="user-defaults-tab">
      <p className="text-xs text-white/40 mb-4">
        Set your default notification preferences. These apply to all projects unless overridden.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-xs text-white/40 uppercase tracking-wider">
              <th className="text-left py-2 px-3">Event</th>
              {CHANNEL_TYPES.map((ch) => (
                <th key={ch} className="text-center py-2 px-3">
                  {ch}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {EVENT_DOMAINS.map(({ key, label }) => (
              <tr key={key} className="border-t border-white/5">
                <td className="py-3 px-3 text-sm text-white/80">{label}</td>
                {CHANNEL_TYPES.map((ch) => {
                  const enabled = settings[key]?.[ch] ?? true;
                  return (
                    <td key={ch} className="text-center py-3 px-3">
                      <button
                        onClick={() => toggle(key, ch)}
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
      <div className="flex justify-end pt-4">
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          Save Preferences
        </button>
      </div>
    </div>
  );
}

function ProjectOverridesTab({
  selectedProject,
  onSelectProject
}: {
  selectedProject: string;
  onSelectProject: (id: string) => void;
}) {
  return (
    <div className="space-y-4" data-testid="project-overrides-tab">
      <p className="text-xs text-white/40 mb-4">
        Override notification settings for specific projects. Unset values inherit from user
        defaults.
      </p>

      {/* Project Selector */}
      <div className="flex gap-2 flex-wrap mb-4">
        {MOCK_PROJECTS.map((proj) => (
          <button
            key={proj.id}
            onClick={() => onSelectProject(proj.id)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
              selectedProject === proj.id
                ? "bg-blue-600 text-white"
                : "bg-white/5 text-white/60 hover:bg-white/10"
            }`}
          >
            {proj.name}
          </button>
        ))}
      </div>

      {/* Override Grid */}
      <div className="space-y-2">
        {EVENT_DOMAINS.map(({ key, label }) => (
          <div key={key} className="card p-3 flex items-center justify-between">
            <span className="text-sm text-white/80">{label}</span>
            <div className="flex gap-3">
              {CHANNEL_TYPES.map((ch) => (
                <label key={ch} className="flex items-center gap-1 text-xs text-white/50">
                  <select className="bg-white/5 border border-white/10 rounded text-xs text-white/60 px-1 py-0.5">
                    <option value="inherit">inherit</option>
                    <option value="on">on</option>
                    <option value="off">off</option>
                  </select>
                  {ch}
                </label>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="flex justify-end pt-4">
        <button className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors">
          Save Overrides
        </button>
      </div>
    </div>
  );
}

function ActivityLogTab() {
  const mockLogs = [
    {
      id: "1",
      event: "backup.succeeded",
      channel: "slack",
      status: "delivered",
      time: "2 min ago"
    },
    {
      id: "2",
      event: "deploy.completed",
      channel: "discord",
      status: "delivered",
      time: "15 min ago"
    },
    { id: "3", event: "backup.failed", channel: "email", status: "failed", time: "1hr ago" },
    {
      id: "4",
      event: "server.health.warning",
      channel: "web_push",
      status: "delivered",
      time: "3hr ago"
    }
  ];

  return (
    <div className="space-y-2" data-testid="activity-log-tab">
      <p className="text-xs text-white/40 mb-4">Recent notification delivery log</p>
      {mockLogs.map((log) => (
        <div key={log.id} className="card p-3 flex items-center gap-3">
          <div
            className={`w-2 h-2 rounded-full ${
              log.status === "delivered" ? "bg-emerald-400" : "bg-red-400"
            }`}
          />
          <span className="text-sm text-white/80 flex-1">{log.event}</span>
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50">
            {log.channel}
          </span>
          <span className="text-xs text-white/30">{log.time}</span>
        </div>
      ))}
    </div>
  );
}
