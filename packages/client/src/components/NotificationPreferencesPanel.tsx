import { useMemo, useState } from "react";
import { trpc } from "../lib/trpc";
import {
  NOTIFICATION_CHANNEL_TYPES,
  NOTIFICATION_EVENT_DOMAINS,
  labelChannelType
} from "@/lib/notification-config";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";

type PreferenceValue = Record<string, boolean>;

function makePreferenceKey(eventType: string, channelType: string) {
  return `${eventType}:${channelType}`;
}

export function NotificationPreferencesPanel() {
  const utils = trpc.useUtils();
  const projects = trpc.projects.useQuery({ limit: 100 });
  const userPreferences = trpc.getUserPreferences.useQuery();
  const [selectedProjectId, setSelectedProjectId] = useState<string>("");
  const projectOverrides = trpc.getProjectOverrides.useQuery(
    { projectId: selectedProjectId },
    { enabled: selectedProjectId.length > 0 }
  );

  const setUserPreference = trpc.setUserPreference.useMutation({
    onSuccess: async () => {
      await utils.getUserPreferences.invalidate();
    }
  });

  const setProjectOverride = trpc.setProjectOverride.useMutation({
    onSuccess: async () => {
      if (selectedProjectId) {
        await utils.getProjectOverrides.invalidate({ projectId: selectedProjectId });
      }
    }
  });

  const preferenceMap = useMemo(() => {
    const map: PreferenceValue = {};
    for (const pref of userPreferences.data ?? []) {
      map[makePreferenceKey(pref.eventType, pref.channelType)] = pref.enabled;
    }
    return map;
  }, [userPreferences.data]);

  const projectOverrideMap = useMemo(() => {
    const map: PreferenceValue = {};
    for (const override of projectOverrides.data ?? []) {
      map[makePreferenceKey(override.eventType, override.channelType)] = override.enabled;
    }
    return map;
  }, [projectOverrides.data]);

  const projectOptions = projects.data ?? [];

  return (
    <div className="grid gap-6 lg:grid-cols-[1.3fr_1fr]">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">User Notification Defaults</CardTitle>
          <CardDescription>
            Control which event families are enabled for each delivery channel.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {userPreferences.isLoading ? (
            <div className="space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
            </div>
          ) : (
            <div className="space-y-4">
              {NOTIFICATION_EVENT_DOMAINS.map((domain) => (
                <div key={domain.domain} className="rounded-lg border p-4">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">{domain.label}</p>
                      <p className="text-xs text-muted-foreground">{domain.domain}</p>
                    </div>
                    <Badge variant="secondary">{domain.events.length} events</Badge>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                    {NOTIFICATION_CHANNEL_TYPES.map((channelType) => {
                      const key = makePreferenceKey(domain.domain, channelType);
                      const enabled = preferenceMap[key] ?? true;
                      return (
                        <button
                          key={channelType}
                          type="button"
                          className={`flex items-center justify-between rounded-md border px-3 py-2 text-sm transition-colors ${
                            enabled
                              ? "border-primary/40 bg-primary/5"
                              : "border-border bg-background"
                          }`}
                          onClick={() =>
                            setUserPreference.mutate({
                              eventType: domain.domain,
                              channelType,
                              enabled: !enabled
                            })
                          }
                          disabled={setUserPreference.isPending}
                        >
                          <span>{labelChannelType(channelType)}</span>
                          <Badge variant={enabled ? "default" : "secondary"}>
                            {enabled ? "On" : "Off"}
                          </Badge>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Project Overrides</CardTitle>
            <CardDescription>
              Override defaults for one project when incidents require tighter signal routing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <p className="text-sm font-medium">Project</p>
              <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
                <SelectTrigger>
                  <SelectValue placeholder="Select a project" />
                </SelectTrigger>
                <SelectContent>
                  {projectOptions.map((project) => (
                    <SelectItem key={String(project.id)} value={String(project.id)}>
                      {String(project.name)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {selectedProjectId.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Choose a project to manage override preferences.
              </p>
            ) : projectOverrides.isLoading ? (
              <div className="space-y-2">
                <Skeleton className="h-12 w-full" />
                <Skeleton className="h-12 w-full" />
              </div>
            ) : (
              <div className="space-y-3">
                {NOTIFICATION_EVENT_DOMAINS.map((domain) => (
                  <div key={domain.domain} className="rounded-lg border p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="text-sm font-medium">{domain.label}</span>
                      <span className="text-xs text-muted-foreground">{domain.domain}</span>
                    </div>
                    <div className="grid gap-2">
                      {NOTIFICATION_CHANNEL_TYPES.map((channelType) => {
                        const key = makePreferenceKey(domain.domain, channelType);
                        const enabled = projectOverrideMap[key] ?? preferenceMap[key] ?? true;
                        return (
                          <div
                            key={channelType}
                            className="flex items-center justify-between gap-3"
                          >
                            <span className="text-sm">{labelChannelType(channelType)}</span>
                            <Button
                              type="button"
                              size="sm"
                              variant={enabled ? "default" : "outline"}
                              onClick={() =>
                                setProjectOverride.mutate({
                                  projectId: selectedProjectId,
                                  eventType: domain.domain,
                                  channelType,
                                  enabled: !enabled
                                })
                              }
                              disabled={setProjectOverride.isPending}
                            >
                              {enabled ? "Enabled" : "Disabled"}
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Delivery Activity</CardTitle>
            <CardDescription>
              Recent notification attempts across configured channels.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <NotificationDeliveryActivity />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function NotificationDeliveryActivity() {
  const logs = trpc.listDeliveryLogs.useQuery({ limit: 10 });

  if (logs.isLoading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    );
  }

  if (!logs.data || logs.data.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">No notification deliveries recorded yet.</p>
    );
  }

  return (
    <div className="space-y-3">
      {logs.data.map((log) => (
        <div key={String(log.id)} className="rounded-lg border p-3">
          <div className="mb-1 flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium">{String(log.eventType)}</p>
              <p className="text-xs text-muted-foreground">
                {String(log.channelName)} · {labelChannelType(String(log.channelType))}
              </p>
            </div>
            <Badge
              variant={
                log.status === "sent" || log.status === "delivered" ? "default" : "destructive"
              }
            >
              {String(log.status)}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            {new Date(String(log.sentAt)).toLocaleString()}
            {log.httpStatus ? ` · HTTP ${String(log.httpStatus)}` : ""}
          </p>
        </div>
      ))}
    </div>
  );
}
