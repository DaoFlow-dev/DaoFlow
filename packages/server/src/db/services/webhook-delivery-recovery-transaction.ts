import { db } from "../connection";

export type WebhookDeliveryRecoveryTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
