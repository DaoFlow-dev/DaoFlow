import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Power, Trash2 } from "lucide-react";
import { labelChannelType } from "@/lib/notification-config";

interface Channel {
  id: unknown;
  name: unknown;
  channelType: unknown;
  email?: unknown;
  webhookUrl?: unknown;
  enabled: boolean;
  eventSelectors?: unknown;
  createdAt: unknown;
}

interface ChannelCardListProps {
  channels: Channel[];
  onToggle: (id: string, enabled: boolean) => void;
  onDelete: (id: string) => void;
  isTogglePending: boolean;
  isDeletePending: boolean;
}

export function ChannelCardList({
  channels,
  onToggle,
  onDelete,
  isTogglePending,
  isDeletePending
}: ChannelCardListProps) {
  return (
    <div className="grid gap-4">
      {channels.map((channel) => (
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
                  onClick={() => onToggle(String(channel.id), !channel.enabled)}
                  disabled={isTogglePending}
                >
                  <Power size={14} />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => onDelete(String(channel.id))}
                  disabled={isDeletePending}
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
  );
}
