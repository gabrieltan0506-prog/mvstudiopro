import { int, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * 展廳互動 - 點讚記錄
 */
export const showcaseLikes = mysqlTable("showcase_likes", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  videoSubmissionId: int("videoSubmissionId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseLike = typeof showcaseLikes.$inferSelect;

/**
 * 展廳互動 - 收藏記錄
 */
export const showcaseFavorites = mysqlTable("showcase_favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  videoSubmissionId: int("videoSubmissionId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseFavorite = typeof showcaseFavorites.$inferSelect;

/**
 * 展廳互動 - 評論記錄
 */
export const showcaseComments = mysqlTable("showcase_comments", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  videoSubmissionId: int("videoSubmissionId").notNull(),
  content: text("content").notNull(),
  /** 父評論 ID（回覆功能） */
  parentId: int("parentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseComment = typeof showcaseComments.$inferSelect;

/**
 * 維護公告表
 */
export const maintenanceNotices = mysqlTable("maintenance_notices", {
  id: int("id").autoincrement().primaryKey(),
  /** 公告標題 */
  title: varchar("title", { length: 255 }).notNull(),
  /** 公告內容 */
  content: text("content").notNull(),
  /** 維護開始時間 */
  startTime: timestamp("startTime").notNull(),
  /** 維護結束時間 */
  endTime: timestamp("endTime").notNull(),
  /** 是否啟用 */
  isActive: int("isActive").default(1).notNull(),
  /** 創建者（管理員 ID） */
  createdBy: int("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MaintenanceNotice = typeof maintenanceNotices.$inferSelect;

/**
 * 流量統計表（每小時匯總）
 */
export const trafficStats = mysqlTable("traffic_stats", {
  id: int("id").autoincrement().primaryKey(),
  /** 統計時段（小時精度） */
  hourBucket: timestamp("hourBucket").notNull(),
  /** 請求次數 */
  requestCount: int("requestCount").default(0).notNull(),
  /** 唯一用戶數 */
  uniqueUsers: int("uniqueUsers").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrafficStat = typeof trafficStats.$inferSelect;
