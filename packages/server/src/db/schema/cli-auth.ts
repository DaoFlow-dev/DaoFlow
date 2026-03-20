import { index, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { users } from "./users";

export const cliAuthRequests = pgTable(
  "cli_auth_requests",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    userCode: varchar("user_code", { length: 16 }).notNull(),
    exchangeCode: varchar("exchange_code", { length: 40 }),
    sessionTokenEncrypted: text("session_token_encrypted"),
    approvedByUserId: text("approved_by_user_id").references(() => users.id, {
      onDelete: "set null"
    }),
    approvedByEmail: varchar("approved_by_email", { length: 320 }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    approvedAt: timestamp("approved_at"),
    exchangedAt: timestamp("exchanged_at")
  },
  (table) => [
    index("cli_auth_requests_user_code_idx").on(table.userCode),
    index("cli_auth_requests_exchange_code_idx").on(table.exchangeCode),
    index("cli_auth_requests_expires_at_idx").on(table.expiresAt),
    index("cli_auth_requests_approved_by_user_id_idx").on(table.approvedByUserId)
  ]
);
