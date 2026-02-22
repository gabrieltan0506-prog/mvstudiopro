import { int, mysqlEnum, mysqlTable, text, timestamp, varchar, boolean } from "drizzle-orm/mysql-core";

/**
 * Unified creation records & favorites system
 * 
 * user_creations: Auto-records every generation (idol, music, 3D, video, kling)
 * user_favorites: User-managed favorites/bookmarks for any creation
 * 
 * Retention policy:
 * - Free users: 10 days (remind after 2 days to download/upgrade)
 * - Pro users: 3 months
 * - Enterprise users: 6 months
 */

// ─── Unified Creation Records ─────────────────────────
export const userCreations = mysqlTable("user_creations", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  /** Type of creation */
  type: mysqlEnum("type", [
    "idol_image",      // 虛擬偶像圖片
    "idol_3d",         // 偶像 3D 模型
    "music",           // Suno 音樂
    "video",           // 視頻生成（Veo/Kling）
    "storyboard",      // 分鏡腳本
    "kling_video",     // 可靈視頻
    "kling_lipsync",   // 可靈口型同步
    "kling_motion",    // 可靈動作遷移
    "kling_image",     // 可靈圖片生成
  ]).notNull(),
  
  /** Display title (auto-generated or user-set) */
  title: varchar("title", { length: 255 }),
  
  /** Primary output URL (image/video/audio/model) */
  outputUrl: text("outputUrl"),
  
  /** Secondary output URL (e.g., OBJ for 3D, thumbnail for video) */
  secondaryUrl: text("secondaryUrl"),
  
  /** Thumbnail/preview URL */
  thumbnailUrl: text("thumbnailUrl"),
  
  /** JSON metadata (prompt, style, model, settings, etc.) */
  metadata: text("metadata"),
  
  /** Quality tier used */
  quality: varchar("quality", { length: 20 }),
  
  /** Credits consumed */
  creditsUsed: int("creditsUsed").default(0),
  
  /** Status */
  status: mysqlEnum("status", ["pending", "completed", "failed", "expired"]).default("completed").notNull(),
  
  /** Expiry date (based on user plan) */
  expiresAt: timestamp("expiresAt"),
  
  /** Whether user has been reminded about expiry */
  expiryReminded: boolean("expiryReminded").default(false).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserCreation = typeof userCreations.$inferSelect;
export type InsertUserCreation = typeof userCreations.$inferInsert;

// ─── User Favorites ───────────────────────────────────
export const userFavorites = mysqlTable("user_favorites", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(),
  
  /** Reference to user_creations.id */
  creationId: int("creationId").notNull(),
  
  /** Optional user note/tag */
  note: varchar("note", { length: 500 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = typeof userFavorites.$inferInsert;
