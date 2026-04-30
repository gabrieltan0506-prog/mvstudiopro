-- ============================================================================
-- 0003_jobs_status_queued_index.sql
--
-- hotfix(egress): jobs 队列轮询命中 partial index，堵住 seq_scan 泄漏
--
-- 背景：
--   pg_stat_user_tables 截至本 PR 显示：
--     jobs 表 seq_scan=382,404 / seq_tup_read=15,314,290（全表 63 行）
--   worker 每 1 秒 claimNextQueuedJob 一次，每次对 jobs 做全表 seq_scan。
--   99% 情况下队列是空的，但 Neon→Fly 每 tick 都把全表 63 行的 input/output
--   JSONB 压出来再过滤。
--
-- 修法：建一个 **partial index** 只覆盖 queued 行，worker 走
--   ORDER BY "createdAt" LIMIT 1 时直接命中 btree。
--
-- 应用方式（重要 — 不走 drizzle-kit migrate，沿用 drizzle/postgres/README.md 手动流程）：
--   1. 在 Neon Console SQL Editor 中打开
--   2. 用 BEGIN / ROLLBACK 先演练（见本目录 README 的 Step 1）
--   3. 演练 OK 后直接执行下面的 CONCURRENTLY 版本（不能在 transaction 里）
--
-- 列命名一律加双引号（与 drizzle schema 对齐，jobs 的 createdAt / status
-- 都是 camelCase，大小写敏感）。
-- ============================================================================

CREATE INDEX IF NOT EXISTS "idx_jobs_queued_created"
  ON "jobs" ("createdAt")
  WHERE "status" = 'queued';
