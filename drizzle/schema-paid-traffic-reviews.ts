import { decimal, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** 投流投后复盘：用户回填实测投放数据（花费/曝光/点击/转化/营收），用于算真实 CPA 与 ROI 曲线。 */
export const paidTrafficReviews = pgTable("paid_traffic_reviews", {
  id: serial().primaryKey(),
  userId: integer("userId").notNull(), // FK → users.id
  platform: varchar("platform", { length: 32 }),
  campaignName: varchar("campaignName", { length: 255 }),
  spend: decimal("spend", { precision: 12, scale: 2 }).notNull(),
  impressions: integer("impressions").default(0).notNull(),
  clicks: integer("clicks").default(0).notNull(),
  conversions: integer("conversions").default(0).notNull(),
  revenue: decimal("revenue", { precision: 12, scale: 2 }).default("0").notNull(),
  notes: text("notes"),
  measuredAt: timestamp("measuredAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type PaidTrafficReview = typeof paidTrafficReviews.$inferSelect;
export type InsertPaidTrafficReview = typeof paidTrafficReviews.$inferInsert;
