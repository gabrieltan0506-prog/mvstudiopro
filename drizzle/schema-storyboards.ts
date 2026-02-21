import { int, mysqlEnum, mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

/**
 * Storyboards table for manual review workflow
 * Stores all generated storyboards with review status
 */
export const storyboards = mysqlTable("storyboards", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull(), // Foreign key to users.id
  lyrics: text("lyrics").notNull(), // Original lyrics input
  sceneCount: int("sceneCount").notNull(), // Number of scenes requested
  storyboard: text("storyboard").notNull(), // JSON string of generated storyboard
  status: mysqlEnum("status", [
    "pending", // 待審核
    "approved", // 已通過
    "rejected", // 已拒絕
  ]).default("pending").notNull(),
  rejectionReason: text("rejectionReason"), // Reason for rejection (if rejected)
  reviewedBy: int("reviewedBy"), // Admin user ID who reviewed (Foreign key to users.id)
  reviewedAt: timestamp("reviewedAt"), // When the review was completed
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type Storyboard = typeof storyboards.$inferSelect;
export type InsertStoryboard = typeof storyboards.$inferInsert;
