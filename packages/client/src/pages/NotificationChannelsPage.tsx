import { useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import {
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_EVENT_DOMAINS,
  labelChannelType
} from "@/lib/notification-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Bell, Plus, Power, Trash2 } from "lucide-react";

function toggleSelector(collection: string[], selector: string) {
  return collection.includes(selector)
    ? collection.filter((value) => value !== selector)
    : [...collection, selector];
}

export default function NotificationChannelsPage() {
  const utils = trpc.useUtils();
  const channels = trpc.listChannels.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [channelType, setChannelType] =
    useState<(typeof NOTIFICATION_CHANNEL_TYPES)[number]>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [email, setEmail] = useState("");
  const [eventSelectors, setEventSelectors] = useState<string[]>(["deploy.*"]);

  const createChannel = trpc.createChannel.useMutation({
    onSuccess: async () => {
      await utils.listChannels.invalidate();
      setDialogOpen(false);
      resetForm();
    }
  });

  const deleteChannel = trpc.deleteChannel.useMutation({
    onSuccess: async () => {
      await utils.listChannels.invalidate();
    }
  });

  const toggleChannel = trpc.toggleChannel.useMutation({
    onSuccess: async () => {
      await utils.listChannels.invalidate();
    }
  });

  const canSubmit = useMemo(() => {
    if (!name.trim()) {
      return false;
    }

    if (channelType === "email") {
      return email.trim().length > 0;
    }

    if (channelType === "web_push") {
      return true;
    }

    return webhookUrl.trim().length > 0;
  }, [channelType, email, name, webhookUrl]);

  function resetForm() {
    setName("");
    setChannelType("slack");
    setWebhookUrl("");
    setEmail("");
    setEventSelectors(["deploy.*"]);
  }

  const items = channels.data ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Notification Channels</h1>
          <p className="text-sm text-muted-foreground">
            Route deploy, backup, server, and security events to the right delivery channels.
          </p>
        </div>

        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button>
              <Plus size={16} /> Add Channel
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-2xl">
            <DialogHeader>
              <DialogTitle>Create Notification Channel</DialogTitle>
              <DialogDescription>
                Define one delivery target and the event selectors that should reach it.
              </DialogDescription>
            </DialogHeader>

            <form
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                createChannel.mutate({
                  name: name.trim(),
                  channelType,
                  webhookUrl:
                    channelType === "email" || channelType === "web_push"
                      ? undefined
                      : webhookUrl.trim() || undefined,
                  email: channelType === "email" ? email.trim() || undefined : undefined,
                  eventSelectors,
                  enabled: true
                });
              }}
            >
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="channel-name">Channel Name</Label>
                  <Input
                    id="channel-name"
                    placeholder="Production Alerts"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>Channel Type</Label>
                  <div className="flex flex-wrap gap-2">
                    {NOTIFICATION_CHANNEL_TYPES.map((type) => (
                      <Button
                        key={type}
                        type="button"
                        variant={channelType === type ? "default" : "outline"}
                        size="sm"
                        onClick={() => setChannelType(type)}
                      >
                        {labelChannelType(type)}
                      </Button>
                    ))}
                  </div>
                </div>
              </div>

              {channelType === "email" ? (
                <div className="space-y-2">
                  <Label htmlFor="channel-email">Recipient Email</Label>
                  <Input
                    id="channel-email"
                    type="email"
                    placeholder="ops@daoflow.local"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    required
                  />
                </div>
              ) : channelType === "web_push" ? (
                <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
                  Web Push channels deliver to subscribed browsers. No webhook URL is required.
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="channel-webhook">Webhook URL</Label>
                  <Input
                    id="channel-webhook"
                    type="url"
                    placeholder="https://hooks.example.com/daoflow"
                    value={webhookUrl}
                    onChange={(event) => setWebhookUrl(event.target.value)}
                    required
                  />
                </div>
              )}

              <div className="space-y-3">
                <div>
                  <p className="text-sm font-medium">Event Selectors</p>
                  <p className="text-xs text-muted-foreground">
                    Wildcards such as <code>deploy.*</code> and <code>*</code> are supported.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {NOTIFICATION_EVENT_DOMAINS.map((domain) => (
                    <div key={domain.domain} className="rounded-lg border p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <button
                          type="button"
                          className="text-left"
                          onClick={() =>
                            setEventSelectors((current) => toggleSelector(current, domain.domain))
                          }
                        >
                          <p className="text-sm font-medium">{domain.label}</p>
                          <p className="text-xs text-muted-foreground">{domain.domain}</p>
                        </button>
                        <Badge
                          variant={eventSelectors.includes(domain.domain) ? "default" : "secondary"}
                        >
                          {eventSelectors.includes(domain.domain) ? "Enabled" : "Optional"}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {domain.events.map((eventType) => (
                          <Button
                            key={eventType}
                            type="button"
                            size="sm"
                            variant={eventSelectors.includes(eventType) ? "default" : "outline"}
                            onClick={() =>
                              setEventSelectors((current) => toggleSelector(current, eventType))
                            }
                          >
                            {eventType}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <DialogFooter>
                <Button type="button" variant="ghost" onClick={() => setDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={!canSubmit || createChannel.isPending}>
                  {createChannel.isPending ? "Saving..." : "Create Channel"}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {channels.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <Bell size={32} className="text-muted-foreground" />
            <div>
              <p className="font-medium">No notification channels configured</p>
              <p className="text-sm text-muted-foreground">
                Add a delivery target before enabling project-specific routing preferences.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((channel) => (
            <Card key={String(channel.id)}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-base">{String(channel.name)}</CardTitle>
                    <CardDescription>
                      {labelChannelType(String(channel.channelType))}
                      {channel.email ? ` · ${String(channel.email)}` : ""}
                      {!channel.email && channel.webhookUrl
                        ? ` · ${String(channel.webhookUrl)}`
                        : ""}
                    </CardDescription>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={channel.enabled ? "default" : "secondary"}>
                      {channel.enabled ? "Enabled" : "Disabled"}
                    </Badge>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() =>
                        toggleChannel.mutate({
                          id: String(channel.id),
                          enabled: !channel.enabled
                        })
                      }
                      disabled={toggleChannel.isPending}
                    >
                      <Power size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteChannel.mutate({ id: String(channel.id) })}
                      disabled={deleteChannel.isPending}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex flex-wrap gap-2">
                  {(Array.isArray(channel.eventSelectors) ? channel.eventSelectors : []).map(
                    (selector) => (
                      <Badge key={String(selector)} variant="outline">
                        {String(selector)}
                      </Badge>
                    )
                  )}
                </div>
                <p className="text-xs text-muted-foreground">
                  Created {new Date(String(channel.createdAt)).toLocaleString()}
                </p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </main>
  );
}
