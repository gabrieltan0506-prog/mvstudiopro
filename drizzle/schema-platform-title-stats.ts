import { index, integer, pgTable, serial, text, timestamp, varchar } from "drizzle-orm/pg-core";

/** Stage2 選題卡：標題 A/B 的曝光與選用次數（一行一事實，可聚合）。 */
export const platformTitleVariantEvents = pgTable(
  "platform_title_variant_events",
  {
    id: serial().primaryKey(),
    userId: integer("userId").notNull(),
    topicId: text("topicId").notNull(),
    variantId: varchar("variantId", { length: 32 }).notNull(),
    kind: varchar("kind", { length: 16 }).notNull(),
    createdAt: timestamp("createdAt", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    topicIdx: index("platform_title_variant_events_topic_idx").on(t.topicId),
    topicKindIdx: index("platform_title_variant_events_topic_kind_idx").on(t.topicId, t.kind),
  }),
);

export type PlatformTitleVariantEvent = typeof platformTitleVariantEvents.$inferSelect;
export type InsertPlatformTitleVariantEvent = typeof platformTitleVariantEvents.$inferInsert;
