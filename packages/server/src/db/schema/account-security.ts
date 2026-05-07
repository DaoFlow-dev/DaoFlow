import { index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { teams } from "./teams";
import { users } from "./users";

export const accountSecurityPolicies = pgTable(
  "account_security_policies",
  {
    teamId: varchar("team_id", { length: 32 })
      .primaryKey()
      .references(() => teams.id, { onDelete: "cascade" }),
    mfaRequirement: varchar("mfa_requirement", { length: 20 }).default("optional").notNull(),
    updatedByUserId: varchar("updated_by_user_id", { length: 320 }).references(() => users.id, {
      onDelete: "set null"
    }),
    updatedAt: timestamp("updated_at").defaultNow().notNull()
  },
  (table) => [index("account_security_policies_requirement_idx").on(table.mfaRequirement)]
);
