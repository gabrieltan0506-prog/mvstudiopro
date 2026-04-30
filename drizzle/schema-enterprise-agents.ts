import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  varchar,
} from "drizzle-orm/pg-core";

/**
 * 企业专属智能体（AaaS）— 三张表
 *
 * 业务背景：
 *   - Trial: ¥15,000 / 30 天 / 100 次调用 / 50 MB 知识库
 *   - Pro:   ¥50,000-200,000 / 永久 / 多 Agent / 知识库无上限
 *   两档共用同一份 schema，靠 `tier` 字段区分限额。
 *
 * 计费集成：
 *   - 创建 agent 时 paidJobLedger 锁定试用费 / 部署费，jobId 形如
 *     `enterpriseAgent_${agentId}_trial_${ts}` —— 写入本表的 paidJobLedgerJobId 字段。
 *   - paidJobLedger 是文件系统状态机（/data/active-jobs/*.json），jobId 是 string，
 *     **不是** Postgres FK，所以 paidJobLedgerJobId 用 varchar(64) 而不是 integer。
 *   - 试用过期走 paidJobLedger.refundCreditsOnFailure 的 `user_cancelled_no_refund`
 *     分支（不退款，仅 settle）。
 *
 * 隔离保证：
 *   - GCS bucket 路径按 userId / agentId 隔离 (gs://mvstudio-enterprise/${userId}/agents/${agentId}/...)
 *   - 每次推演调用写一行 enterpriseAgentSessions 作为审计日志
 *
 * 列命名约定：与 users / userCreations / userFeedback 等已有表一致，使用 camelCase
 * 物理列名（PG 会因大写字母自动加引号）。
 */

// ─── ① Agents 主表 ────────────────────────────────────────
export const enterpriseAgents = pgTable(
  "enterprise_agents",
  {
    id: serial().primaryKey(),

    /** 企业账号管理员 user.id（关联 users 表，但软关联，不建外键） */
    userId: integer("userId").notNull(),

    /** 企业 / 组织名（展示用，可选） */
    organizationName: varchar("organizationName", { length: 200 }),

    /** Agent 显示名（同一 userId 下唯一） */
    agentName: varchar("agentName", { length: 100 }).notNull(),

    /** 灵魂指令 / systemInstruction，调用时拼进 Gemini systemInstruction */
    systemCommand: text("systemCommand").notNull(),

    /** 档位：'trial' | 'pro' */
    tier: varchar("tier", { length: 20 }).notNull(),

    /** 状态：'active' | 'expired' | 'deleted' */
    status: varchar("status", { length: 20 }).notNull().default("active"),

    /** 仅 trial 用：试用到期时间（默认创建后 +30 天） */
    trialUntil: timestamp("trialUntil"),

    /** 知识库总配额（MB），trial 默认 50，pro 可设极大值 */
    knowledgeBaseQuotaMb: integer("knowledgeBaseQuotaMb").notNull().default(50),

    /** 当前已用知识库容量（MB），上传/删除时同步更新 */
    knowledgeBaseUsedMb: integer("knowledgeBaseUsedMb").notNull().default(0),

    /** 当前周期内的调用次数（quotaPeriodStart 之后的累计） */
    callsThisPeriod: integer("callsThisPeriod").notNull().default(0),

    /** 周期内的调用配额（trial 100，pro 可调大） */
    callsQuotaPeriod: integer("callsQuotaPeriod").notNull().default(100),

    /** 当前配额周期起点；服务层检测到 now > start+30d 时重置 callsThisPeriod */
    quotaPeriodStart: timestamp("quotaPeriodStart").defaultNow().notNull(),

    /** 关联 paidJobLedger 文件 hold 的 jobId（string，不是 FK） */
    paidJobLedgerJobId: varchar("paidJobLedgerJobId", { length: 64 }),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
    updatedAt: timestamp("updatedAt").defaultNow().notNull(),
  },
  (t) => [
    index("enterprise_agents_userId_idx").on(t.userId),
    index("enterprise_agents_status_idx").on(t.status),
    uniqueIndex("enterprise_agents_user_name_uniq").on(t.userId, t.agentName),
  ],
);

export type EnterpriseAgent = typeof enterpriseAgents.$inferSelect;
export type InsertEnterpriseAgent = typeof enterpriseAgents.$inferInsert;

// ─── ② 知识库文档表 ────────────────────────────────────────
export const enterpriseAgentKnowledgeBase = pgTable(
  "enterprise_agent_kb",
  {
    id: serial().primaryKey(),

    /** 关联 enterprise_agents.id（软关联） */
    agentId: integer("agentId").notNull(),

    /** 用户上传时的原始文件名（带扩展名） */
    filename: varchar("filename", { length: 300 }).notNull(),

    /** GCS 对象 key，如 "${userId}/agents/${agentId}/${hash}.pdf" */
    gcsKey: varchar("gcsKey", { length: 500 }).notNull(),

    /** 原始文件字节数（用于配额校验，校验单位 MB = ceil(bytes/1024/1024)） */
    fileSizeBytes: integer("fileSizeBytes").notNull(),

    /** 抽取文本的 SHA-256，用来去重（同一 agent 内不允许重复内容） */
    contentTextHash: varchar("contentTextHash", { length: 64 }),

    /** 抽取文本头 500 字预览（admin 后台验证用，executeAgentQuery 不读这一列） */
    extractedTextPreview: text("extractedTextPreview"),

    /**
     * 抽取出的完整文本 — executeAgentQuery 拼 systemInstruction 时读这一列。
     *
     * 设计选择：把全文落 DB 而不是每次 GCS download + 重新 parse，是为了
     *   1. 调用延迟稳定（DB 单查 < 50ms vs GCS 来回 + strings 抽取 1-3s）
     *   2. Agent 推演高频调用，不希望叠加 GCS 出口流量
     *   3. PG TEXT 列上限 1GB，trial 总和 50MB 完全装得下
     *
     * 注：PR-3 manual migration `drizzle/postgres/0002_enterprise_agent_kb_full_text.sql`
     * 把这一列加到生产 Neon。本地 / 单测无需 migration（drizzle-orm 类型已对齐）。
     */
    extractedTextFull: text("extractedTextFull"),

    uploadedAt: timestamp("uploadedAt").defaultNow().notNull(),
  },
  (t) => [
    index("enterprise_agent_kb_agentId_idx").on(t.agentId),
    uniqueIndex("enterprise_agent_kb_agent_hash_uniq").on(
      t.agentId,
      t.contentTextHash,
    ),
  ],
);

export type EnterpriseAgentKb = typeof enterpriseAgentKnowledgeBase.$inferSelect;
export type InsertEnterpriseAgentKb =
  typeof enterpriseAgentKnowledgeBase.$inferInsert;

// ─── ③ 调用 / 推演会话审计日志 ──────────────────────────────
export const enterpriseAgentSessions = pgTable(
  "enterprise_agent_sessions",
  {
    id: serial().primaryKey(),

    /** 关联 enterprise_agents.id */
    agentId: integer("agentId").notNull(),

    /** 用户提问 / 推演输入 */
    userQuery: text("userQuery").notNull(),

    /** Gemini 返回的 markdown 推演结果 */
    responseMarkdown: text("responseMarkdown"),

    /** Gemini usageMetadata.promptTokenCount */
    promptTokens: integer("promptTokens"),

    /** Gemini usageMetadata.candidatesTokenCount */
    outputTokens: integer("outputTokens"),

    /** 模型标识，如 "gemini-3.1-pro" */
    modelUsed: varchar("modelUsed", { length: 60 }),

    /** 端到端耗时（毫秒） */
    durationMs: integer("durationMs"),

    createdAt: timestamp("createdAt").defaultNow().notNull(),
  },
  (t) => [
    index("enterprise_agent_sessions_agentId_idx").on(t.agentId),
    index("enterprise_agent_sessions_createdAt_idx").on(t.createdAt),
  ],
);

export type EnterpriseAgentSession =
  typeof enterpriseAgentSessions.$inferSelect;
export type InsertEnterpriseAgentSession =
  typeof enterpriseAgentSessions.$inferInsert;
