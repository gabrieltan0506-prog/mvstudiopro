import {
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  varchar,
  index,
} from "drizzle-orm/pg-core";

/** 用户授权收录的匿名资产参考（人物/场景/服装道具） */
export const manhuaCommunityAssets = pgTable(
  "manhua_community_assets",
  {
    id: serial("id").primaryKey(),
    /** 公开 id，如 cma_xxx */
    publicId: varchar("publicId", { length: 48 }).notNull().unique(),
    role: varchar("role", { length: 16 }).notNull(),
    imageUrl: text("imageUrl").notNull(),
    labelZh: varchar("labelZh", { length: 80 }),
    /** 仅服务端审计；列表接口不返回 */
    contributorUserId: integer("contributorUserId").notNull(),
    createdAt: timestamp("createdAt").notNull().defaultNow(),
  },
  (t) => [index("manhua_community_assets_role_idx").on(t.role)],
);

export type ManhuaCommunityAssetRow = typeof manhuaCommunityAssets.$inferSelect;
