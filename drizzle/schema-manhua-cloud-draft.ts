import { integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

/**
 * 漫剧云端草稿：按用户同步分集剧本 + 静帧 URL（不含成片视频）。
 * 一用户一条「当前草稿」；payloadJson 存 v1 结构。
 */
export const manhuaCloudDrafts = pgTable(
  "manhua_cloud_drafts",
  {
    id: serial().primaryKey(),
    userId: integer("userId").notNull(),
    /** mv-manhua-cloud-draft-v1 JSON */
    payloadJson: text("payloadJson").notNull(),
    /** 客户端修订时间（ISO），用于多端冲突时取较新 */
    clientUpdatedAt: timestamp("clientUpdatedAt").notNull(),
    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [uniqueIndex("manhua_cloud_drafts_user_uidx").on(t.userId)],
);

export type ManhuaCloudDraftRow = typeof manhuaCloudDrafts.$inferSelect;
export type InsertManhuaCloudDraft = typeof manhuaCloudDrafts.$inferInsert;
