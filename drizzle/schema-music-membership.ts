import { int, mysqlTable, timestamp } from "drizzle-orm/mysql-core";

/**
 * Music membership credits for Suno generation.
 *
 * - musicCredits: single-purchase bucket (8 credits per generation)
 * - packageCredits: package bucket (1 credit per generation)
 * - freeTrackCount/freeSecondsUsed: free-tier counters
 */
export const musicMembershipCredits = mysqlTable("music_membership_credits", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  musicCredits: int("musicCredits").default(0).notNull(),
  packageCredits: int("packageCredits").default(0).notNull(),
  freeTrackCount: int("freeTrackCount").default(0).notNull(),
  freeSecondsUsed: int("freeSecondsUsed").default(0).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type MusicMembershipCredit = typeof musicMembershipCredits.$inferSelect;
export type InsertMusicMembershipCredit = typeof musicMembershipCredits.$inferInsert;
