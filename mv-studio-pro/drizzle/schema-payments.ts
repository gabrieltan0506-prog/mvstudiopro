import { mysqlTable, serial, varchar, text, timestamp, int, mysqlEnum } from "drizzle-orm/mysql-core";
import { users } from "./schema";

export const paymentSubmissions = mysqlTable("payment_submissions", {
  id: serial("id").primaryKey(),
  userId: int("user_id").notNull().references(() => users.id),
  packageType: varchar("package_type", { length: 50 }).notNull(), // 套餐類型：basic, pro, enterprise
  amount: varchar("amount", { length: 20 }).notNull(), // 付款金額
  paymentMethod: varchar("payment_method", { length: 50 }), // 付款方式：支付寶、微信、銀行轉帳等
  screenshotUrl: text("screenshot_url").notNull(), // 付款截圖 URL
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).notNull().default("pending"), // 審核狀態
  rejectionReason: text("rejection_reason"), // 拒絕原因
  reviewedBy: int("reviewed_by").references(() => users.id), // 審核管理員 ID
  reviewedAt: timestamp("reviewed_at"), // 審核時間
  createdAt: timestamp("created_at").notNull().defaultNow(), // 提交時間
  updatedAt: timestamp("updated_at").notNull().defaultNow().onUpdateNow(), // 更新時間
});
