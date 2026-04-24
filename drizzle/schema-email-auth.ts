import { pgTable, serial, varchar, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Email 認證表
 * 儲存用戶的 Email 和加密後的密碼
 */
export const emailAuth = pgTable("email_auth", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  userId: integer("user_id").notNull(), // 關聯到 users 表
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type EmailAuth = typeof emailAuth.$inferSelect;
export type NewEmailAuth = typeof emailAuth.$inferInsert;
