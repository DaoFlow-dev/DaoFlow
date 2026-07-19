import { relations } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar
} from "drizzle-orm/pg-core";
import { deployments } from "./deployments";
import { teams } from "./teams";

/**
 * One stable external feedback target per DaoFlow deployment and linked provider.
 * The target lease serializes feedback rows so future adapters update one external
 * deployment/status/comment instead of racing to create multiple objects.
 */
export const providerFeedbackTargets = pgTable(
  "provider_feedback_targets",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    deploymentId: varchar("deployment_id", { length: 32 })
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 32 }).notNull(),
    providerKind: varchar("provider_kind", { length: 20 }).notNull(),
    externalDeploymentId: varchar("external_deployment_id", { length: 255 }),
    externalStatusId: varchar("external_status_id", { length: 255 }),
    externalCommentId: varchar("external_comment_id", { length: 255 }),
    context: jsonb("context").default({}).notNull(),
    leaseToken: varchar("lease_token", { length: 64 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("provider_feedback_targets_deployment_idx").on(table.deploymentId),
    index("provider_feedback_targets_team_id_idx").on(table.teamId),
    index("provider_feedback_targets_lease_expires_at_idx").on(table.leaseExpiresAt)
  ]
);

/**
 * Durable, provider-neutral deployment transition feedback. The context is a
 * deliberately safe immutable snapshot for future provider adapters; it never
 * stores credentials or provider response bodies.
 */
export const providerFeedback = pgTable(
  "provider_feedback",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    deliverySequence: serial("sequence").notNull(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    targetId: varchar("target_id", { length: 32 })
      .notNull()
      .references(() => providerFeedbackTargets.id, { onDelete: "cascade" }),
    deploymentId: varchar("deployment_id", { length: 32 })
      .notNull()
      .references(() => deployments.id, { onDelete: "cascade" }),
    providerId: varchar("provider_id", { length: 32 }).notNull(),
    providerKind: varchar("provider_kind", { length: 20 }).notNull(),
    transition: varchar("transition", { length: 40 }).notNull(),
    idempotencyKey: varchar("idempotency_key", { length: 160 }).notNull(),
    state: varchar("state", { length: 20 }).default("pending").notNull(),
    attemptCount: integer("attempt_count").default(0).notNull(),
    nextAttemptAt: timestamp("next_attempt_at").defaultNow().notNull(),
    leaseToken: varchar("lease_token", { length: 64 }),
    leaseExpiresAt: timestamp("lease_expires_at"),
    safeError: text("safe_error"),
    context: jsonb("context").default({}).notNull(),
    externalDeploymentId: varchar("external_deployment_id", { length: 255 }),
    externalStatusId: varchar("external_status_id", { length: 255 }),
    externalCommentId: varchar("external_comment_id", { length: 255 }),
    deliveredAt: timestamp("delivered_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("provider_feedback_idempotency_key_idx").on(table.idempotencyKey),
    uniqueIndex("provider_feedback_sequence_idx").on(table.deliverySequence),
    index("provider_feedback_deployment_id_idx").on(table.deploymentId),
    index("provider_feedback_team_state_created_at_idx").on(
      table.teamId,
      table.state,
      table.createdAt
    ),
    index("provider_feedback_claim_idx").on(table.state, table.nextAttemptAt),
    index("provider_feedback_lease_expires_at_idx").on(table.leaseExpiresAt),
    index("provider_feedback_target_state_sequence_idx").on(
      table.targetId,
      table.state,
      table.deliverySequence
    )
  ]
);

export const providerFeedbackTargetsRelations = relations(
  providerFeedbackTargets,
  ({ many, one }) => ({
    deployment: one(deployments, {
      fields: [providerFeedbackTargets.deploymentId],
      references: [deployments.id]
    }),
    team: one(teams, {
      fields: [providerFeedbackTargets.teamId],
      references: [teams.id]
    }),
    feedback: many(providerFeedback)
  })
);

export const providerFeedbackRelations = relations(providerFeedback, ({ one }) => ({
  deployment: one(deployments, {
    fields: [providerFeedback.deploymentId],
    references: [deployments.id]
  }),
  target: one(providerFeedbackTargets, {
    fields: [providerFeedback.targetId],
    references: [providerFeedbackTargets.id]
  }),
  team: one(teams, {
    fields: [providerFeedback.teamId],
    references: [teams.id]
  })
}));
