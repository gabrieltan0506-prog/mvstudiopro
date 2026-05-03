-- ============================================================================
-- 0003_users_enterprise_trial_paid.sql
--
-- 與 drizzle/schema.ts `users.enterpriseTrialPaid` 對齊。
-- 若生產庫未執行本語句，所有 select * from users 會報「欄位不存在」，
-- 請求鏈路失敗後前端易被重導向登入頁。
--
-- 應用：Neon Console SQL Editor（先 BEGIN … ROLLBACK 演練，再 COMMIT），
--       流程見 drizzle/postgres/README.md。
-- 生產環境亦可不手動執行：server/db.ts 在首次連庫時會自動 ALTER IF NOT EXISTS。
-- ============================================================================

ALTER TABLE "users"
ADD COLUMN IF NOT EXISTS "enterpriseTrialPaid" boolean NOT NULL DEFAULT false;
