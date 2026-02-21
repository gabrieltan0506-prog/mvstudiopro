import { mysqlTable, varchar, timestamp, int } from "drizzle-orm/mysql-core";

/**
 * Email 認證表
 * 儲存用戶的 Email 和加密後的密碼
 */
export const emailAuth = mysqlTable("email_auth", {
  id: int("id").primaryKey().autoincrement(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: varchar("password_hash", { length: 255 }).notNull(),
  userId: int("user_id").notNull(), // 關聯到 users 表
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(),
});

export type EmailAuth = typeof emailAuth.$inferSelect;
export type NewEmailAuth = typeof emailAuth.$inferInsert;
