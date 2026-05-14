import { integer, pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * DR-Pro 雙條：副選題在入隊時凍結於此表，worker 優先讀取；任務結案後刪除（Neon，非 Fly 卷）。
 * 避免 worker 執行期間副選題快照被改寫，且 job JSON 不長期攜帶大段 context。
 */
export const platformDrSecondaryStaging = pgTable("platform_dr_secondary_staging", {
  jobId: varchar("jobId", { length: 64 }).primaryKey(),
  userId: integer("userId").notNull(),
  primarySceneId: text("primarySceneId").notNull(),
  secondarySceneId: text("secondarySceneId").notNull(),
  secondaryTopicHook: text("secondaryTopicHook").notNull(),
  secondaryContext: text("secondaryContext").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PlatformDrSecondaryStaging = typeof platformDrSecondaryStaging.$inferSelect;
export type InsertPlatformDrSecondaryStaging = typeof platformDrSecondaryStaging.$inferInsert;
