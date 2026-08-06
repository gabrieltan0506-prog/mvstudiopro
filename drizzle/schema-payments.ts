import { pgTable, serial, varchar, text, timestamp, integer } from "drizzle-orm/pg-core";
import { users } from "./schema";

export const paymentSubmissions = pgTable("payment_submissions", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => users.id),
  packageType: varchar("package_type", { length: 50 }).notNull(), // 套餐類型：basic, pro, enterprise
  amount: varchar("amount", { length: 20 }).notNull(), // 付款金額
  paymentMethod: varchar("payment_method", { length: 50 }), // 付款方式：支付寶、微信、銀行轉帳等
  screenshotUrl: text("screenshot_url").notNull(), // 付款截圖 URL
  status: text("status").notNull().default("pending"), // 審核狀態
  /** 收款編號：給用戶看的那串，也是對賬主鍵（MV-YYYYMMDD-XXXXXX） */
  orderNo: varchar("order_no", { length: 40 }),
  /** 該單應發積分（提交時按套餐算好，避免審核時再算一次算錯） */
  creditsExpected: integer("credits_expected"),
  /** 實際發出的積分 */
  creditsGranted: integer("credits_granted"),
  /** 截圖 sha256：同一張圖只能用一次 */
  screenshotSha256: varchar("screenshot_sha256", { length: 64 }),
  /** 自動核銷判定：approved / review / rejected */
  autoVerdict: text("auto_verdict"),
  /** 判定依據（中文短句，僅管理員可見） */
  autoReason: text("auto_reason"),
  /** 模型從截圖讀到的原始字段（JSON），事後複盤誤判用 */
  autoExtract: text("auto_extract"),
  autoCheckedAt: timestamp("auto_checked_at"),
  rejectionReason: text("rejection_reason"), // 拒絕原因
  reviewedBy: integer("reviewed_by").references(() => users.id), // 審核管理員 ID
  reviewedAt: timestamp("reviewed_at"), // 審核時間
  createdAt: timestamp("created_at").notNull().defaultNow(), // 提交時間
  updatedAt: timestamp("updated_at").notNull().defaultNow(), // 更新時間
});
