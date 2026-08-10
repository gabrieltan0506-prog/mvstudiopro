-- 付费任务幂等扣费键 + 图文卡提炼档位凭证
-- 生产 Neon 请按 README 的 BEGIN/ROLLBACK 演练流程执行后再部署读写代码。

ALTER TABLE "stripe_usage_logs"
ADD COLUMN IF NOT EXISTS "chargeKey" varchar(120);

CREATE UNIQUE INDEX IF NOT EXISTS "stripe_usage_logs_charge_key_uniq"
  ON "stripe_usage_logs" ("chargeKey")
  WHERE "chargeKey" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "knowledge_card_distill_receipts" (
  "id"        serial PRIMARY KEY,
  "userId"    integer NOT NULL,
  "textHash"  varchar(64) NOT NULL,
  "model"     varchar(40) NOT NULL,
  "createdAt" timestamp NOT NULL DEFAULT now()
);

DROP INDEX IF EXISTS "kc_distill_receipts_user_hash_uniq";

CREATE UNIQUE INDEX IF NOT EXISTS "kc_distill_receipts_user_hash_model_uniq"
  ON "knowledge_card_distill_receipts" ("userId", "textHash", "model");
