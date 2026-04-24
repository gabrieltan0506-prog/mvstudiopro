import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";

export const videoShortLinks = pgTable("video_short_links", {
  taskId: varchar("taskId", { length: 128 }).primaryKey(),
  videoUrl: text("videoUrl").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type VideoShortLink = typeof videoShortLinks.$inferSelect;
export type InsertVideoShortLink = typeof videoShortLinks.$inferInsert;
