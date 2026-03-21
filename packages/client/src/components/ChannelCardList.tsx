import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Power, Trash2, Send } from "lucide-react";
import { labelChannelType } from "@/lib/notification-config";

interface Channel {
  id: unknown;
  name: unknown;
  channelType: unknown;
  email?: unknown;
  webhookUrl?: unknown;
  projectFilter?: unknown;
  environmentFilter?: unknown;
  enabled: boolean;
  eventSelectors?: unknown;
  createdAt: unknown;
}

interface ChannelCardListProps {
  channels: Channel[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  onTest?: (id: string) => void;
  isTogglePending: boolean;
  isDeletePending: boolean;
  isTestPending?: boolean;
}

function readText(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

export function ChannelCardList({
  channels,
  onToggle,
  onDelete,
  onTest,
  isTogglePending,
  isDeletePending,
  isTestPending
}: ChannelCardListProps) {
  return (
    <div className="grid gap-4">
      {channels.map((channel) => (
        <Card key={readText(channel.id, "channel")}>
          <CardHeader className="pb-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <CardTitle className="text-base">
                  {readText(channel.name, "Unnamed channel")}
                </CardTitle>
                <CardDescription>
                  {labelChannelType(readText(channel.channelType))}
                  {readText(channel.email) ? ` · ${readText(channel.email)}` : ""}
                  {!readText(channel.email) && readText(channel.webhookUrl)
                    ? ` · ${readText(channel.webhookUrl)}`
                    : ""}
                </CardDescription>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={channel.enabled ? "default" : "secondary"}>
                  {channel.enabled ? "Enabled" : "Disabled"}
                </Badge>
                {onTest && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => onTest(readText(channel.id, "channel"))}
                    disabled={isTestPending}
                    title="Send test notification"
                    data-testid={`notification-channel-test-${readText(channel.id, "channel")}`}
                  >
                    <Send size={14} className="mr-1" />
                    Test
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onToggle(readText(channel.id, "channel"), !channel.enabled)}
                  disabled={isTogglePending}
                  data-testid={`notification-channel-toggle-${readText(channel.id, "channel")}`}
                >
                  <Power size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(readText(channel.id, "channel"))}
                  disabled={isDeletePending}
                  data-testid={`notification-channel-delete-${readText(channel.id, "channel")}`}
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
              {readText(channel.projectFilter) ? (
                <Badge variant="secondary">Project: {readText(channel.projectFilter)}</Badge>
              ) : null}
              {readText(channel.environmentFilter) ? (
                <Badge variant="secondary">Env: {readText(channel.environmentFilter)}</Badge>
              ) : null}
            </div>
            <p
              className="text-xs text-muted-foreground"
              data-testid={`notification-channel-created-${readText(channel.id, "channel")}`}
            >
              Created {new Date(readText(channel.createdAt)).toLocaleString()}
            </p>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
