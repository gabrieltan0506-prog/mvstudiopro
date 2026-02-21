import { int, mysqlTable, text, timestamp, varchar, mysqlEnum, json } from "drizzle-orm/mysql-core";

/**
 * 用戶實名認證表
 *
 * 上傳視頻前必須完成實名認證。
 */
export const userVerifications = mysqlTable("user_verifications", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().unique(),
  /** 真實姓名 */
  realName: varchar("realName", { length: 100 }).notNull(),
  /** 身份證號碼（加密存儲，僅保留後 4 位用於展示） */
  idNumberMasked: varchar("idNumberMasked", { length: 20 }).notNull(),
  /** 身份證正面照片 URL */
  idFrontUrl: text("idFrontUrl"),
  /** 身份證反面照片 URL */
  idBackUrl: text("idBackUrl"),
  /** 認證狀態 */
  status: mysqlEnum("status", ["pending", "approved", "rejected"]).default("pending").notNull(),
  /** 管理員審核備註 */
  adminNotes: text("adminNotes"),
  /** 審核時間 */
  reviewedAt: timestamp("reviewedAt"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type UserVerification = typeof userVerifications.$inferSelect;
export type InsertUserVerification = typeof userVerifications.$inferInsert;

/**
 * 用戶上傳視頻表
 *
 * 業務規則：
 * - 上傳前必須已完成實名認證
 * - 視頻必須已在至少一個平台（抖音/視頻號/小紅書/B站）發布
 * - 必須提供後台數據截圖 + 視頻發布鏈接
 * - 同一視頻多平台分發只計算一次（通過 contentFingerprint 去重）
 * - 上傳前必須勾選同意平台授權協議
 *
 * 爆款評分獎勵：
 * - 80-89 分：獎勵 30 Credits，平台可無償展示和二次開發
 * - 90-100 分：獎勵 80 Credits，平台可無償展示和二次開發
 * - 80 分以下：無獎勵
 *
 * 授權條款（獲獎即生效）：
 * - 平台可無償展示該視頻
 * - 平台可進行二次開發
 * - 無需告知原作者
 */
export const videoSubmissions = mysqlTable("video_submissions", {
  id: int("id").autoincrement().primaryKey(),

  /** 上傳用戶 ID */
  userId: int("userId").notNull(),

  /** 視頻標題 */
  title: varchar("title", { length: 255 }).notNull(),

  /** 視頻描述 */
  description: text("description"),

  /** 視頻文件 URL（S3 存儲，用戶上傳的原始視頻） */
  videoUrl: text("videoUrl").notNull(),

  /** 視頻封面圖 URL */
  thumbnailUrl: text("thumbnailUrl"),

  /** 視頻時長（秒） */
  duration: int("duration"),

  /** 視頻分類標籤 */
  category: varchar("category", { length: 100 }),

  /**
   * 內容指紋（用於去重）
   * 同一視頻在多平台分發時，通過此欄位判斷是否為同一內容。
   * 由後端根據視頻文件 hash 或用戶自行聲明生成。
   */
  contentFingerprint: varchar("contentFingerprint", { length: 128 }),

  /** AI 爆款評分（0-100） */
  viralScore: int("viralScore"),

  /** AI 評分詳情（JSON：各維度得分 + 文字分析） */
  scoreDetails: json("scoreDetails"),

  /** 評分狀態 */
  scoreStatus: mysqlEnum("scoreStatus", ["pending", "scoring", "scored", "failed"]).default("pending").notNull(),

  /** ─── 授權協議 ─── */

  /** 是否同意平台授權協議（0=否，1=是） */
  licenseAgreed: int("licenseAgreed").default(0).notNull(),

  /** 授權協議版本 */
  licenseVersion: varchar("licenseVersion", { length: 20 }).default("1.0"),

  /** 同意授權的時間 */
  licenseAgreedAt: timestamp("licenseAgreedAt"),

  /** ─── Credits 獎勵 ─── */

  /** Credits 獎勵金額（0 = 未獎勵） */
  creditsRewarded: int("creditsRewarded").default(0).notNull(),

  /** 獎勵發放時間 */
  rewardedAt: timestamp("rewardedAt"),

  /** ─── 平台展示 ─── */

  /** 平台展示狀態 */
  showcaseStatus: mysqlEnum("showcaseStatus", ["private", "pending_review", "showcased", "rejected"]).default("private").notNull(),

  /** 管理員審核備註 */
  adminNotes: text("adminNotes"),

  /** 視頻觀看次數（平台展示後統計） */
  viewCount: int("viewCount").default(0).notNull(),

  /** 視頻點讚次數 */
  likeCount: int("likeCount").default(0).notNull(),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type VideoSubmission = typeof videoSubmissions.$inferSelect;
export type InsertVideoSubmission = typeof videoSubmissions.$inferInsert;

/**
 * 視頻平台發布記錄表
 *
 * 一個視頻可以在多個平台發布，每個平台一條記錄。
 * 用於驗證視頻確實已在平台發布，以及去重判斷。
 */
export const videoPlatformLinks = mysqlTable("video_platform_links", {
  id: int("id").autoincrement().primaryKey(),

  /** 關聯的視頻提交 ID */
  videoSubmissionId: int("videoSubmissionId").notNull(),

  /** 發布平台 */
  platform: mysqlEnum("platform", ["douyin", "weixin_channels", "xiaohongshu", "bilibili"]).notNull(),

  /** 平台上的視頻發布鏈接 */
  videoLink: text("videoLink").notNull(),

  /** 後台數據截圖 URL（播放量、點讚數等） */
  dataScreenshotUrl: text("dataScreenshotUrl").notNull(),

  /** 平台上的播放量（從截圖中提取或用戶填寫） */
  playCount: int("playCount"),

  /** 平台上的點讚數 */
  likeCount: int("likeCount"),

  /** 平台上的評論數 */
  commentCount: int("commentCount"),

  /** 平台上的分享/轉發數 */
  shareCount: int("shareCount"),

  /** 驗證狀態（管理員核實截圖和鏈接真實性） */
  verifyStatus: mysqlEnum("verifyStatus", ["pending", "verified", "rejected"]).default("pending").notNull(),

  /** 管理員驗證備註 */
  verifyNotes: text("verifyNotes"),

  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export type VideoPlatformLink = typeof videoPlatformLinks.$inferSelect;
export type InsertVideoPlatformLink = typeof videoPlatformLinks.$inferInsert;
