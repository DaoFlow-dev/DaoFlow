import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Plus } from "lucide-react";
import {
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_EVENT_DOMAINS,
  labelChannelType
} from "@/lib/notification-config";

function toggleSelector(collection: string[], selector: string) {
  return collection.includes(selector)
    ? collection.filter((value) => value !== selector)
    : [...collection, selector];
}

type ChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

interface AddChannelDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (data: {
    name: string;
    channelType: ChannelType;
    webhookUrl?: string;
    email?: string;
    eventSelectors: string[];
    enabled: boolean;
  }) => void;
  isPending: boolean;
}

export function AddChannelDialog({
  open,
  onOpenChange,
  onSubmit,
  isPending
}: AddChannelDialogProps) {
  const [name, setName] = useState("");
  const [channelType, setChannelType] =
    useState<(typeof NOTIFICATION_CHANNEL_TYPES)[number]>("slack");
  const [webhookUrl, setWebhookUrl] = useState("");
  const [email, setEmail] = useState("");
  const [eventSelectors, setEventSelectors] = useState<string[]>(["deploy.*"]);

  const canSubmit = useMemo(() => {
    if (!name.trim()) return false;
    if (channelType === "email") return email.trim().length > 0;
    if (channelType === "web_push") return true;
    return webhookUrl.trim().length > 0;
  }, [channelType, email, name, webhookUrl]);

  function resetForm() {
    setName("");
    setChannelType("slack");
    setWebhookUrl("");
    setEmail("");
    setEventSelectors(["deploy.*"]);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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
            onSubmit({
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
            resetForm();
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

          <EventSelectorGrid
            eventSelectors={eventSelectors}
            setEventSelectors={setEventSelectors}
          />

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit || isPending}>
              {isPending ? "Saving..." : "Create Channel"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EventSelectorGrid({
  eventSelectors,
  setEventSelectors
}: {
  eventSelectors: string[];
  setEventSelectors: React.Dispatch<React.SetStateAction<string[]>>;
}) {
  return (
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
              <Badge variant={eventSelectors.includes(domain.domain) ? "default" : "secondary"}>
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
                  onClick={() => setEventSelectors((current) => toggleSelector(current, eventType))}
                >
                  {eventType}
                </Button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
