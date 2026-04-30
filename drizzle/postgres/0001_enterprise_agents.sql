-- ============================================================================
-- 0001_enterprise_agents.sql
--
-- 企业专属智能体（AaaS）— PR-1 schema 落地
--
-- 应用方式（重要 — 不走 drizzle-kit migrate）：
--   1. 在 Neon Console SQL Editor 中打开
--   2. 用 BEGIN / ROLLBACK 先演练（见 drizzle/postgres/README.md）
--   3. 演练 OK 后用 BEGIN / ... / COMMIT 真正执行
--
-- 设计要点：
--   - 列命名 camelCase（与 users / userCreations / userFeedback 等已有表对齐）
--     PG 因大写字母会自动加双引号 quoted，本文件已显式加 ""
--   - 三张表均用 IF NOT EXISTS，幂等可重跑
--   - paidJobLedgerJobId 是 varchar，不是 FK——paidJobLedger 是文件系统状态机
--   - 不写外键约束（关联 users / agents 走软关联，与现有表风格一致）
-- ============================================================================

-- ─── ① enterprise_agents ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enterprise_agents" (
  "id"                    SERIAL PRIMARY KEY,
  "userId"                INTEGER       NOT NULL,
  "organizationName"      VARCHAR(200),
  "agentName"             VARCHAR(100)  NOT NULL,
  "systemCommand"         TEXT          NOT NULL,
  "tier"                  VARCHAR(20)   NOT NULL,
  "status"                VARCHAR(20)   NOT NULL DEFAULT 'active',
  "trialUntil"            TIMESTAMP,
  "knowledgeBaseQuotaMb"  INTEGER       NOT NULL DEFAULT 50,
  "knowledgeBaseUsedMb"   INTEGER       NOT NULL DEFAULT 0,
  "callsThisPeriod"       INTEGER       NOT NULL DEFAULT 0,
  "callsQuotaPeriod"      INTEGER       NOT NULL DEFAULT 100,
  "quotaPeriodStart"      TIMESTAMP     NOT NULL DEFAULT now(),
  "paidJobLedgerJobId"    VARCHAR(64),
  "createdAt"             TIMESTAMP     NOT NULL DEFAULT now(),
  "updatedAt"             TIMESTAMP     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "enterprise_agents_userId_idx"
  ON "enterprise_agents" ("userId");

CREATE INDEX IF NOT EXISTS "enterprise_agents_status_idx"
  ON "enterprise_agents" ("status");

CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_agents_user_name_uniq"
  ON "enterprise_agents" ("userId", "agentName");

-- ─── ② enterprise_agent_kb ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enterprise_agent_kb" (
  "id"                     SERIAL PRIMARY KEY,
  "agentId"                INTEGER       NOT NULL,
  "filename"               VARCHAR(300)  NOT NULL,
  "gcsKey"                 VARCHAR(500)  NOT NULL,
  "fileSizeBytes"          INTEGER       NOT NULL,
  "contentTextHash"        VARCHAR(64),
  "extractedTextPreview"   TEXT,
  "uploadedAt"             TIMESTAMP     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "enterprise_agent_kb_agentId_idx"
  ON "enterprise_agent_kb" ("agentId");

-- 注意：PG 默认 NULLS DISTINCT，多行 contentTextHash=NULL 不会互相冲突。
--       业务侧解析失败时 hash 可空，重试不会被这个 unique 卡住。
CREATE UNIQUE INDEX IF NOT EXISTS "enterprise_agent_kb_agent_hash_uniq"
  ON "enterprise_agent_kb" ("agentId", "contentTextHash");

-- ─── ③ enterprise_agent_sessions ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "enterprise_agent_sessions" (
  "id"                  SERIAL PRIMARY KEY,
  "agentId"             INTEGER       NOT NULL,
  "userQuery"           TEXT          NOT NULL,
  "responseMarkdown"    TEXT,
  "promptTokens"        INTEGER,
  "outputTokens"        INTEGER,
  "modelUsed"           VARCHAR(60),
  "durationMs"          INTEGER,
  "createdAt"           TIMESTAMP     NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "enterprise_agent_sessions_agentId_idx"
  ON "enterprise_agent_sessions" ("agentId");

CREATE INDEX IF NOT EXISTS "enterprise_agent_sessions_createdAt_idx"
  ON "enterprise_agent_sessions" ("createdAt");
