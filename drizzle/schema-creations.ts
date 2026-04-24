import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

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
export const userCreations = pgTable("user_creations", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  
  /** Type of creation */
  type: text("type").notNull(),
  
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
  creditsUsed: integer("creditsUsed").default(0),
  
  /** Status */
  status: text("status").default("completed").notNull(),
  
  /** Expiry date (based on user plan) */
  expiresAt: timestamp("expiresAt"),
  
  /** Whether user has been reminded about expiry */
  expiryReminded: boolean("expiryReminded").default(false).notNull(),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type UserCreation = typeof userCreations.$inferSelect;
export type InsertUserCreation = typeof userCreations.$inferInsert;

// ─── User Favorites ───────────────────────────────────
export const userFavorites = pgTable("user_favorites", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(),
  
  /** Reference to user_creations.id */
  creationId: integer("creationId").notNull(),
  
  /** Optional user note/tag */
  note: varchar("note", { length: 500 }),
  
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type UserFavorite = typeof userFavorites.$inferSelect;
export type InsertUserFavorite = typeof userFavorites.$inferInsert;
