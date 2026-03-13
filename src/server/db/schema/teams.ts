import {
  index,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
  boolean
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

export const teams = pgTable(
  "teams",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    slug: varchar("slug", { length: 40 }),
    hasAvatar: boolean("has_avatar").default(false).notNull(),
    status: varchar("status", { length: 20 }).default("active").notNull(),
    createdByUserId: serial("created_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [
    uniqueIndex("teams_slug_idx").on(table.slug),
    index("teams_name_idx").on(table.name),
    index("teams_created_at_idx").on(table.createdAt)
  ]
);

export const teamMembers = pgTable(
  "team_members",
  {
    id: serial("id").primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    userId: serial("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: varchar("role", { length: 20 }).default("member").notNull(), // owner | admin | member
    createdAt: timestamp("created_at").defaultNow().notNull()
  },
  (table) => [
    index("team_members_team_id_idx").on(table.teamId),
    index("team_members_user_id_idx").on(table.userId)
  ]
);

export const teamInvites = pgTable(
  "team_invites",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    teamId: varchar("team_id", { length: 32 })
      .notNull()
      .references(() => teams.id, { onDelete: "cascade" }),
    email: varchar("email", { length: 320 }).notNull(),
    role: varchar("role", { length: 20 }).default("member").notNull(),
    status: varchar("status", { length: 20 }).default("pending").notNull(), // pending | accepted | revoked
    inviterId: serial("inviter_id")
      .notNull()
      .references(() => users.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull()
  },
  (table) => [
    index("team_invites_team_id_idx").on(table.teamId),
    index("team_invites_email_idx").on(table.email)
  ]
);

export const teamsRelations = relations(teams, ({ one, many }) => ({
  createdByUser: one(users, {
    fields: [teams.createdByUserId],
    references: [users.id]
  }),
  members: many(teamMembers),
  invites: many(teamInvites)
}));

export const teamMembersRelations = relations(teamMembers, ({ one }) => ({
  team: one(teams, {
    fields: [teamMembers.teamId],
    references: [teams.id]
  }),
  user: one(users, {
    fields: [teamMembers.userId],
    references: [users.id]
  })
}));

export const teamInvitesRelations = relations(teamInvites, ({ one }) => ({
  team: one(teams, {
    fields: [teamInvites.teamId],
    references: [teams.id]
  }),
  inviter: one(users, {
    fields: [teamInvites.inviterId],
    references: [users.id]
  })
}));
