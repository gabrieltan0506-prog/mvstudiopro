import { mysqlTable, int, varchar, text, timestamp, mysqlEnum } from "drizzle-orm/mysql-core";

export const videoSignatures = mysqlTable("video_signatures", {
  id: int("id").primaryKey().autoincrement(),
  userId: int("user_id").notNull(),
  videoUrl: text("video_url").notNull(),
  signatureHash: varchar("signature_hash", { length: 128 }).notNull(),
  source: mysqlEnum("source", ["original", "remix"]).notNull().default("original"),
  videoGenerationId: int("video_generation_id"),
  originalVideoUrl: text("original_video_url"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VideoSignature = typeof videoSignatures.$inferSelect;
export type InsertVideoSignature = typeof videoSignatures.$inferInsert;
