import { integer, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * 平台頁 Stage2：每次成功生成後寫入最新四條選題快照，供封面生圖從 DB 拉齊文案（與前端緩存解耦）。
 */
export const platformStrategicBlueprintSnapshots = pgTable("platform_strategic_blueprint_snapshots", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  windowDays: integer("windowDays").notNull().default(15),
  /** 排序後的平台 key，如 bilibili,douyin,kuaishou,xiaohongshu */
  platformsKey: text("platformsKey").notNull().default(""),
  /** context 前綴摘要，便於運維對照 */
  contextSnippet: text("contextSnippet").notNull().default(""),
  /** JSON：EnrichedBlueprint[] */
  blueprintsJson: text("blueprintsJson").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PlatformStrategicBlueprintSnapshot = typeof platformStrategicBlueprintSnapshots.$inferSelect;
export type InsertPlatformStrategicBlueprintSnapshot = typeof platformStrategicBlueprintSnapshots.$inferInsert;
