/**
 * Task #56: Notification channel CRUD + event selectors UI.
 * Wired to tRPC: listChannels, createChannel, deleteChannel, toggleChannel.
 */
import { useState } from "react";
import { trpc } from "../lib/trpc";
import { useSession } from "../lib/auth-client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Bell, Plus, Trash2, Power } from "lucide-react";

const CHANNEL_TYPES = ["slack", "discord", "email", "generic_webhook", "web_push"] as const;
type ChannelType = (typeof CHANNEL_TYPES)[number];

const CHANNEL_LABELS: Record<ChannelType, string> = {
  slack: "Slack",
  discord: "Discord",
  email: "Email",
  generic_webhook: "Webhook",
  web_push: "Push"
};

const EVENT_DOMAINS = [
  {
    domain: "backup.*",
    label: "Backup Events",
    events: ["backup.started", "backup.succeeded", "backup.failed"]
  },
  {
    domain: "deploy.*",
    label: "Deploy Events",
    events: ["deploy.started", "deploy.succeeded", "deploy.failed", "deploy.rollback"]
  },
  {
    domain: "server.*",
    label: "Server Events",
    events: ["server.connected", "server.disconnected", "server.health.degraded"]
  },
  {
    domain: "security.*",
    label: "Security Events",
    events: ["security.token.created", "security.token.expired", "security.login.failed"]
  }
];

export default function NotificationChannelsPage() {
  const session = useSession();
  const channelsQuery = trpc.listChannels.useQuery(undefined, {
    enabled: Boolean(session.data)
  });
  const createChannel = trpc.createChannel.useMutation({
    onSuccess: () => {
      void channelsQuery.refetch();
      resetForm();
    }
  });
  const deleteChannel = trpc.deleteChannel.useMutation({
    onSuccess: () => void channelsQuery.refetch()
  });
  const toggleChannel = trpc.toggleChannel.useMutation({
    onSuccess: () => void channelsQuery.refetch()
  });

  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [channelType, setChannelType] = useState<ChannelType>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [selectedEvents, setSelectedEvents] = useState<string[]>(["*"]);

  function resetForm() {
    setShowForm(false);
    setName("");
    setChannelType("slack");
    setWebhookUrl("");
    setSelectedEvents(["*"]);
  }

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  function handleSave() {
    createChannel.mutate({
      name,
      channelType,
      webhookUrl: channelType === "web_push" ? undefined : webhookUrl || undefined,
      eventSelectors: selectedEvents.length > 0 ? selectedEvents : ["*"],
      enabled: true
    });
  }

  const channels = channelsQuery.data ?? [];

  return (
    <div className="max-w-4xl mx-auto" data-testid="notification-channels-page">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-white">Notification Channels</h1>
          <p className="text-white/50 text-sm mt-1">
            Configure where DaoFlow sends notifications for events
          </p>
        </div>
        <Button onClick={() => setShowForm(!showForm)} data-testid="add-channel-btn">
          {showForm ? (
            "Cancel"
          ) : (
            <>
              <Plus size={16} /> Add Channel
            </>
          )}
        </Button>
      </div>

      {showForm && (
        <Card className="mb-6">
          <CardContent className="pt-6 space-y-4" data-testid="channel-form">
            {/* Channel Name */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">
                Channel Name
              </label>
              <Input
                value={name}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)}
                placeholder="e.g. Production Alerts"
                data-testid="channel-name-input"
              />
            </div>

            {/* Channel Type */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-1">Type</label>
              <div className="flex gap-2 flex-wrap">
                {CHANNEL_TYPES.map((type) => (
                  <Button
                    key={type}
                    size="sm"
                    variant={channelType === type ? "default" : "outline"}
                    onClick={() => setChannelType(type)}
                  >
                    {CHANNEL_LABELS[type]}
                  </Button>
                ))}
              </div>
            </div>

            {/* Webhook URL / Recipient (hidden for web_push) */}
            {channelType !== "web_push" && (
              <div>
                <label className="block text-sm font-medium text-muted-foreground mb-1">
                  {channelType === "email" ? "Recipient Email" : "Webhook URL"}
                </label>
                <Input
                  value={webhookUrl}
                  onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                    setWebhookUrl(e.target.value)
                  }
                  placeholder={
                    channelType === "email"
                      ? "team@company.com"
                      : channelType === "discord"
                        ? "https://discord.com/api/webhooks/..."
                        : "https://hooks.slack.com/..."
                  }
                  data-testid="channel-url-input"
                />
              </div>
            )}

            {/* Event Selectors */}
            <div>
              <label className="block text-sm font-medium text-muted-foreground mb-2">
                Event Selectors
              </label>
              <div className="space-y-3">
                {EVENT_DOMAINS.map(({ domain, label, events }) => (
                  <div key={domain} className="rounded-lg border p-3">
                    <div className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={selectedEvents.includes(domain) || selectedEvents.includes("*")}
                        onChange={() => toggleEvent(domain)}
                        className="rounded border-white/20"
                      />
                      <span className="text-sm font-medium">{label}</span>
                      <span className="text-xs text-muted-foreground">{domain}</span>
                    </div>
                    <div className="ml-6 flex flex-wrap gap-2">
                      {events.map((event) => (
                        <label
                          key={event}
                          className="flex items-center gap-1.5 text-xs text-muted-foreground"
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
              <Button variant="ghost" onClick={resetForm}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={!name.trim() || createChannel.isPending}
                data-testid="save-channel-btn"
              >
                {createChannel.isPending ? "Saving…" : "Save Channel"}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Channel List */}
      {channelsQuery.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : channels.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <Bell size={32} className="text-muted-foreground" />
          <p className="text-sm text-muted-foreground">
            No notification channels configured. Add a channel to start receiving alerts.
          </p>
        </div>
      ) : (
        <div className="space-y-3" data-testid="channel-list">
          {channels.map((channel) => {
            const selectors = Array.isArray(channel.eventSelectors)
              ? (channel.eventSelectors as string[])
              : [];
            return (
              <Card key={channel.id}>
                <CardContent className="py-4 flex items-center gap-4">
                  <div
                    className={`w-2.5 h-2.5 rounded-full shrink-0 ${
                      channel.enabled ? "bg-emerald-400" : "bg-muted-foreground/30"
                    }`}
                  />
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium">{channel.name}</div>
                    <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                      <Badge variant="secondary">
                        {CHANNEL_LABELS[channel.channelType as ChannelType] ?? channel.channelType}
                      </Badge>
                      {selectors.slice(0, 4).map((e) => (
                        <span key={e} className="text-xs text-muted-foreground">
                          {e}
                        </span>
                      ))}
                      {selectors.length > 4 && (
                        <span className="text-xs text-muted-foreground">
                          +{selectors.length - 4} more
                        </span>
                      )}
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={toggleChannel.isPending}
                    onClick={() =>
                      toggleChannel.mutate({ id: channel.id, enabled: !channel.enabled })
                    }
                  >
                    <Power size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={deleteChannel.isPending}
                    onClick={() => deleteChannel.mutate({ id: channel.id })}
                  >
                    <Trash2 size={14} className="text-destructive" />
                  </Button>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
