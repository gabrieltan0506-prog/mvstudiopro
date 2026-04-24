import { pgTable, serial, integer, varchar, text, timestamp } from "drizzle-orm/pg-core";

export const videoSignatures = pgTable("video_signatures", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull(),
  videoUrl: text("video_url").notNull(),
  signatureHash: varchar("signature_hash", { length: 128 }).notNull(),
  source: text("source").notNull().default("original"),
  videoGenerationId: integer("video_generation_id"),
  originalVideoUrl: text("original_video_url"),
  metadata: text("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export type VideoSignature = typeof videoSignatures.$inferSelect;
export type InsertVideoSignature = typeof videoSignatures.$inferInsert;
