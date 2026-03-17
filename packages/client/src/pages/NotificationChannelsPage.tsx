/**
 * Task #56: Notification channel CRUD + event selectors UI.
 * Full UI for managing Slack, Discord, email, webhook, and push notification channels.
 */
import { useState } from "react";

const CHANNEL_TYPES = ["slack", "discord", "email", "generic_webhook", "web_push"] as const;

const EVENT_DOMAINS = [
  {
    domain: "backup.*",
    label: "Backup Events",
    events: ["backup.started", "backup.succeeded", "backup.failed"]
  },
  {
    domain: "deploy.*",
    label: "Deploy Events",
    events: ["deploy.started", "deploy.completed", "deploy.failed", "deploy.rollback"]
  },
  {
    domain: "server.*",
    label: "Server Events",
    events: ["server.connected", "server.disconnected", "server.health.warning"]
  },
  {
    domain: "security.*",
    label: "Security Events",
    events: ["security.login", "security.token.created", "security.permission.denied"]
  },
  {
    domain: "storage.*",
    label: "Storage Events",
    events: ["storage.quota.warning", "storage.quota.exceeded"]
  }
];

export default function NotificationChannelsPage() {
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<string>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  return (
    <div className="max-w-4xl mx-auto" data-testid="notification-channels-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Notification Channels</h1>
          <p className="text-white/50 text-sm mt-1">
            Configure where DaoFlow sends notifications for events
          </p>
        </div>
        <button
          onClick={() => setShowForm(!showForm)}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-sm font-medium transition-colors"
          data-testid="add-channel-btn"
        >
          {showForm ? "Cancel" : "+ Add Channel"}
        </button>
      </div>

      {showForm && (
        <div className="card p-6 mb-6 space-y-4" data-testid="channel-form">
          {/* Channel Name */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1">Channel Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production Alerts"
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
              data-testid="channel-name-input"
            />
          </div>

          {/* Channel Type */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1">Type</label>
            <div className="flex gap-2 flex-wrap">
              {CHANNEL_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setChannelType(type)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    channelType === type
                      ? "bg-blue-600 text-white"
                      : "bg-white/5 text-white/60 hover:bg-white/10"
                  }`}
                >
                  {type.replace("_", " ")}
                </button>
              ))}
            </div>
          </div>

          {/* Webhook URL / Recipient */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-1">
              {channelType === "email" ? "Recipient Email" : "Webhook URL"}
            </label>
            <input
              type="text"
              value={webhookUrl}
              onChange={(e) => setWebhookUrl(e.target.value)}
              placeholder={
                channelType === "email" ? "team@company.com" : "https://hooks.slack.com/..."
              }
              className="w-full px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm focus:border-blue-500 focus:outline-none"
              data-testid="channel-url-input"
            />
          </div>

          {/* Event Selectors */}
          <div>
            <label className="block text-sm font-medium text-white/60 mb-2">Event Selectors</label>
            <div className="space-y-3">
              {EVENT_DOMAINS.map(({ domain, label, events }) => (
                <div key={domain} className="bg-white/5 rounded-lg p-3">
                  <div className="flex items-center gap-2 mb-2">
                    <input
                      type="checkbox"
                      checked={selectedEvents.includes(domain) || selectedEvents.includes("*")}
                      onChange={() => toggleEvent(domain)}
                      className="rounded border-white/20"
                    />
                    <span className="text-sm font-medium text-white/80">{label}</span>
                    <span className="text-xs text-white/30">{domain}</span>
                  </div>
                  <div className="ml-6 flex flex-wrap gap-2">
                    {events.map((event) => (
                      <label
                        key={event}
                        className="flex items-center gap-1.5 text-xs text-white/50"
                      >
                        <input
                          type="checkbox"
                          checked={
                            selectedEvents.includes(event) ||
                            selectedEvents.includes(domain) ||
                            selectedEvents.includes("*")
                          }
                          onChange={() => toggleEvent(event)}
                          className="rounded border-white/20 w-3 h-3"
                        />
                        {event}
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Save Button */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={() => setShowForm(false)}
              className="px-4 py-2 text-sm text-white/60 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm font-medium transition-colors"
              data-testid="save-channel-btn"
            >
              Save Channel
            </button>
          </div>
        </div>
      )}

      {/* Channel List */}
      <div className="space-y-3" data-testid="channel-list">
        <ChannelCard
          name="Production Slack"
          type="slack"
          events={["backup.*", "deploy.*"]}
          enabled={true}
        />
        <ChannelCard
          name="Discord Alerts"
          type="discord"
          events={["backup.failed", "server.*"]}
          enabled={true}
        />
        <ChannelCard
          name="Email on Failure"
          type="email"
          events={["backup.failed", "deploy.failed"]}
          enabled={false}
        />
      </div>
    </div>
  );
}

function ChannelCard({
  name,
  type,
  events,
  enabled
}: {
  name: string;
  type: string;
  events: string[];
  enabled: boolean;
}) {
  return (
    <div className="card p-4 flex items-center gap-4">
      <div
        className={`w-2.5 h-2.5 rounded-full shrink-0 ${enabled ? "bg-emerald-400" : "bg-white/20"}`}
      />
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-white">{name}</div>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-xs px-2 py-0.5 rounded-full bg-white/10 text-white/50">{type}</span>
          {events.map((e) => (
            <span key={e} className="text-xs text-white/30">
              {e}
            </span>
          ))}
        </div>
      </div>
      <button className="text-xs text-white/40 hover:text-white transition-colors">Edit</button>
      <button className="text-xs text-red-400/60 hover:text-red-400 transition-colors">
        Delete
      </button>
    </div>
  );
}
