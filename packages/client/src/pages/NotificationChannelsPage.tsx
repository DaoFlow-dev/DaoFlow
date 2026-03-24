import { useState } from "react";
import { toast } from "sonner";
import { trpc } from "../lib/trpc";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Bell } from "lucide-react";
import { AddChannelDialog } from "@/components/AddChannelDialog";
import { ChannelCardList } from "@/components/ChannelCardList";

export default function NotificationChannelsPage() {
  const utils = trpc.useUtils();
  const channels = trpc.listChannels.useQuery();
  const [dialogOpen, setDialogOpen] = useState(false);

  async function refreshNotificationViews() {
    await Promise.all([utils.listChannels.invalidate(), utils.listDeliveryLogs.invalidate()]);
  }

  const createChannel = trpc.createChannel.useMutation({
    onSuccess: async () => {
      await refreshNotificationViews();
      setDialogOpen(false);
      toast.success("Notification channel created");
    }
  });

  const deleteChannel = trpc.deleteChannel.useMutation({
    onSuccess: async () => {
      await refreshNotificationViews();
      toast.success("Notification channel removed");
    }
  });

  const toggleChannel = trpc.toggleChannel.useMutation({
    onSuccess: async () => {
      await refreshNotificationViews();
    }
  });

  const testChannel = trpc.testChannel.useMutation({
    onSuccess: async () => {
      await refreshNotificationViews();
      toast.success("Test notification sent");
    },
    onError: (error) => {
      toast.error(error.message || "Failed to send test notification");
    }
  });

  const items = channels.data ?? [];

  return (
    <main className="shell space-y-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight">Notification Channels</h1>
          <p className="text-sm text-muted-foreground">
            Route deploy, backup, server, and security events to the right delivery channels.
          </p>
        </div>

        <AddChannelDialog
          open={dialogOpen}
          onOpenChange={setDialogOpen}
          onSubmit={(data) => createChannel.mutate(data)}
          isPending={createChannel.isPending}
        />
      </div>

      {channels.isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-24 w-full" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-16 text-center">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5">
              <Bell size={28} className="text-primary/50" />
            </div>
            <div>
              <p className="text-sm font-medium text-foreground">
                No notification channels configured
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Add a delivery target before enabling project-specific routing preferences.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : (
        <ChannelCardList
          channels={items}
          onToggle={(id, enabled) => toggleChannel.mutate({ id, enabled })}
          onDelete={(id) => deleteChannel.mutate({ id })}
          onTest={(id) => testChannel.mutate({ id })}
          isTogglePending={toggleChannel.isPending}
          isDeletePending={deleteChannel.isPending}
          isTestPending={testChannel.isPending}
        />
      )}
    </main>
  );
}
