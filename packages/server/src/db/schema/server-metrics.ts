import { doublePrecision, index, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { servers } from "./servers";

export const serverMetrics = pgTable(
  "server_metrics",
  {
    id: varchar("id", { length: 32 }).primaryKey(),
    serverId: varchar("server_id", { length: 32 })
      .notNull()
      .references(() => servers.id, { onDelete: "cascade" }),
    cpuPercent: doublePrecision("cpu_percent").notNull(),
    memoryUsedPercent: doublePrecision("memory_used_percent").notNull(),
    memoryUsedGB: doublePrecision("memory_used_gb").notNull(),
    memoryTotalGB: doublePrecision("memory_total_gb").notNull(),
    diskUsedPercent: doublePrecision("disk_used_percent").notNull(),
    diskTotalGB: doublePrecision("disk_total_gb").notNull(),
    networkInMB: doublePrecision("network_in_mb").notNull(),
    networkOutMB: doublePrecision("network_out_mb").notNull(),
    collectedAt: timestamp("collected_at").notNull()
  },
  (table) => [
    index("server_metrics_server_idx").on(table.serverId),
    index("server_metrics_collected_at_idx").on(table.collectedAt)
  ]
);

export const serverMetricsRelations = relations(serverMetrics, ({ one }) => ({
  server: one(servers, {
    fields: [serverMetrics.serverId],
    references: [servers.id]
  })
}));
