import { boolean, integer, bigint, jsonb, pgTable, primaryKey, text, timestamp, unique } from "drizzle-orm/pg-core";
import { users } from "./schema";
import type { TopicWorkflow } from "../shared/topicDigestWorkflow";
import type { TopicDigest } from "../shared/topicDigest";

/** 与topicDigestStore的幂等初始化DDL保持一致；新用户须主动选择赛道开启。 */
export const topicDigestPreferences = pgTable("topic_digest_preferences", {
  userId: integer("user_id").primaryKey().references(() => users.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull(), lane: text("lane").notNull(), keywords: text("keywords").notNull().default(""),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const topicDigestPools = pgTable("topic_digest_pools", {
  id: text("id").primaryKey(), lane: text("lane").notNull(), period: bigint("period", { mode: "number" }).notNull(),
  pipeline: jsonb("pipeline").$type<TopicWorkflow>(), paidStatus: text("paid_status").notNull().default("pending"),
  paidDigest: jsonb("paid_digest").$type<TopicDigest>(), paidStartedAt: timestamp("paid_started_at", { withTimezone: true }),
  status: text("status").notNull(), digest: jsonb("digest").$type<TopicDigest>(), receipt: jsonb("receipt"), error: text("error"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ lanePeriod: unique("topic_digest_pools_lane_period_key").on(table.lane, table.period) }));
export const topicDigestNotifications = pgTable("topic_digest_notifications", {
  userId: integer("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  poolId: text("pool_id").notNull().references(() => topicDigestPools.id),
  period: bigint("period", { mode: "number" }).notNull(), topicCount: integer("topic_count").notNull(),
  pipelineKind: text("pipeline_kind").notNull().default("deepseek"),
  selectedTopics: jsonb("selected_topics").$type<TopicDigest["topics"]>().notNull(),
  readAt: timestamp("read_at", { withTimezone: true }),
  dismissed: jsonb("dismissed").$type<string[]>().notNull().default([]), adopted: jsonb("adopted").$type<string[]>().notNull().default([]),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, table => ({ pk: primaryKey({ columns: [table.userId, table.poolId] }), userPeriod: unique("topic_digest_notifications_user_id_period_key").on(table.userId,table.period) }));
