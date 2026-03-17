export const NOTIFICATION_CHANNEL_TYPES = [
  "slack",
  "discord",
  "email",
  "generic_webhook",
  "web_push"
] as const;

export type NotificationChannelType = (typeof NOTIFICATION_CHANNEL_TYPES)[number];

export const NOTIFICATION_EVENT_DOMAINS = [
  {
    domain: "backup.*",
    label: "Backup",
    events: ["backup.started", "backup.succeeded", "backup.failed", "backup.pruned"]
  },
  {
    domain: "restore.*",
    label: "Restore",
    events: ["restore.started", "restore.succeeded", "restore.failed"]
  },
  {
    domain: "deploy.*",
    label: "Deploy",
    events: ["deploy.started", "deploy.succeeded", "deploy.failed", "deploy.rollback"]
  },
  {
    domain: "server.*",
    label: "Server",
    events: ["server.connected", "server.disconnected", "server.health.degraded"]
  },
  {
    domain: "security.*",
    label: "Security",
    events: ["security.token.created", "security.token.expired", "security.login.failed"]
  }
] as const;

export function labelChannelType(type: string) {
  switch (type) {
    case "generic_webhook":
      return "Webhook";
    case "web_push":
      return "Web Push";
    default:
      return type.charAt(0).toUpperCase() + type.slice(1);
  }
}
