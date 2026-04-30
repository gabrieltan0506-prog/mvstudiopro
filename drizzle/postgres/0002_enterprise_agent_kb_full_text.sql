-- ─────────────────────────────────────────────────────────────────────────
-- 0002_enterprise_agent_kb_full_text.sql
-- 企业专属智能体（AaaS）— PR-3 知识库全文存储扩展
-- ─────────────────────────────────────────────────────────────────────────
-- 应用方式：用户在 Neon Console SQL Editor 用 BEGIN/ROLLBACK 演练后 COMMIT。
--           本仓库 drizzle-kit 不参与（dialect 历史遗留 mysql / journal 已断裂，
--           参见 drizzle/postgres/README.md 的"不走 drizzle-kit"路径）。
--
-- 变更：
--   enterprise_agent_kb 表新增一列 "extractedTextFull" TEXT NULL
--   - executeAgentQuery 在 PR-3 起读这一列拼 systemInstruction
--   - 相比 GCS 重新 download + strings 解析每次省 1-3s 延迟
--   - PG TEXT 上限 1GB，trial 单 agent 知识库 50MB 完全装得下
--
-- 兼容性：
--   - PR-2 已部署的代码不读 extractedTextFull（NULL safe），不影响线上
--   - 新增列 default NULL，对现有行无破坏，不需要 backfill
--   - PR-3 上传新 KB 文件时一次性写入 preview + full 两列
-- ─────────────────────────────────────────────────────────────────────────

ALTER TABLE "enterprise_agent_kb"
ADD COLUMN IF NOT EXISTS "extractedTextFull" TEXT;

-- 验证：
--   SELECT column_name, data_type, is_nullable
--     FROM information_schema.columns
--    WHERE table_name = 'enterprise_agent_kb'
--      AND column_name = 'extractedTextFull';
--
--   预期：1 行，data_type=text, is_nullable=YES
