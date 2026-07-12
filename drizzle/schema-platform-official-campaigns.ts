import { boolean, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/**
 * 平台官方活动 / 话题征稿策展表（创作者中心活动 + 扶持计划）。
 * 种子见 shared/platformOfficialCampaigns.ts；启动时 ensure + upsert。
 */
export const platformOfficialCampaigns = pgTable("platform_official_campaigns", {
  id: serial().primaryKey(),
  /** 稳定业务 id，如 xhs-summer-life-2026 */
  campaignKey: varchar("campaignKey", { length: 80 }).notNull().unique(),
  platform: varchar("platform", { length: 32 }).notNull(),
  name: text("name").notNull(),
  kind: varchar("kind", { length: 32 }).notNull().default("topic_challenge"),
  category: varchar("category", { length: 48 }).notNull().default("summer_lifestyle"),
  featured: boolean("featured").notNull().default(true),
  personaFit: text("personaFit").notNull().default(""),
  /** JSON string[] */
  topicHooksJson: text("topicHooksJson").notNull().default("[]"),
  /** JSON string[] lane hints */
  laneHintsJson: text("laneHintsJson").notNull().default("[]"),
  summary: text("summary").notNull().default(""),
  status: varchar("status", { length: 16 }).notNull().default("active"),
  sourceNote: text("sourceNote").notNull().default(""),
  reviewedAt: varchar("reviewedAt", { length: 32 }).notNull().default(""),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().notNull(),
});

export type PlatformOfficialCampaign = typeof platformOfficialCampaigns.$inferSelect;
export type InsertPlatformOfficialCampaign = typeof platformOfficialCampaigns.$inferInsert;
