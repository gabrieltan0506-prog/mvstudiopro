import { mysqlTable, text, timestamp, varchar } from "drizzle-orm/mysql-core";

export const videoShortLinks = mysqlTable("video_short_links", {
  taskId: varchar("taskId", { length: 128 }).primaryKey(),
  videoUrl: text("videoUrl").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoShortLink = typeof videoShortLinks.$inferSelect;
export type InsertVideoShortLink = typeof videoShortLinks.$inferInsert;
