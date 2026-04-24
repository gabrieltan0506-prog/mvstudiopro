import { integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * 展廳互動 - 點讚記錄
 */
export const showcaseLikes = pgTable("showcase_likes", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  videoSubmissionId: integer("videoSubmissionId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseLike = typeof showcaseLikes.$inferSelect;

/**
 * 展廳互動 - 收藏記錄
 */
export const showcaseFavorites = pgTable("showcase_favorites", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  videoSubmissionId: integer("videoSubmissionId").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseFavorite = typeof showcaseFavorites.$inferSelect;

/**
 * 展廳互動 - 評論記錄
 */
export const showcaseComments = pgTable("showcase_comments", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  videoSubmissionId: integer("videoSubmissionId").notNull(),
  content: text("content").notNull(),
  /** 父評論 ID（回覆功能） */
  parentId: integer("parentId"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type ShowcaseComment = typeof showcaseComments.$inferSelect;

/**
 * 展廳互動 - 用戶評分記錄（1-5 星）
 */
export const showcaseRatings = pgTable("showcase_ratings", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  videoSubmissionId: integer("videoSubmissionId").notNull(),
  /** 1-5 星評分 */
  rating: integer("rating").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type ShowcaseRating = typeof showcaseRatings.$inferSelect;

/**
 * 維護公告表
 */
export const maintenanceNotices = pgTable("maintenance_notices", {
  id: serial().primaryKey(),
  /** 公告標題 */
  title: varchar("title", { length: 255 }).notNull(),
  /** 公告內容 */
  content: text("content").notNull(),
  /** 維護開始時間 */
  startTime: timestamp("startTime").notNull(),
  /** 維護結束時間 */
  endTime: timestamp("endTime").notNull(),
  /** 是否啟用 */
  isActive: integer("isActive").default(1).notNull(),
  /** 創建者（管理員 ID） */
  createdBy: integer("createdBy").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type MaintenanceNotice = typeof maintenanceNotices.$inferSelect;

/**
 * 流量統計表（每小時匯總）
 */
export const trafficStats = pgTable("traffic_stats", {
  id: serial().primaryKey(),
  /** 統計時段（小時精度） */
  hourBucket: timestamp("hourBucket").notNull(),
  /** 請求次數 */
  requestCount: integer("requestCount").default(0).notNull(),
  /** 唯一用戶數 */
  uniqueUsers: integer("uniqueUsers").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type TrafficStat = typeof trafficStats.$inferSelect;
