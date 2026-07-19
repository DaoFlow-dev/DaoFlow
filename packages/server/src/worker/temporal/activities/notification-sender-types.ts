import type { NotificationEventType } from "../../../db/schema/notifications";

export interface NotificationPayload {
  /** Required team scope for channel and subscription routing. */
  teamId: string;
  eventType: NotificationEventType;
  title: string;
  message: string;
  severity: "info" | "success" | "warning" | "error";
  /** Optional structured fields for rich display */
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  /** Optional context (project, environment, service) for filtering */
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  /** Optional link to the resource */
  url?: string;
  /** Timestamp of the event */
  timestamp?: string;
}

export interface SendResult {
  ok: boolean;
  httpStatus: number;
  error?: string;
}
