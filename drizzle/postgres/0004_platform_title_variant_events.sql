-- Platform Stage2 選題卡：標題變體曝光 / 選用事件（真實計數，可聚合）
-- 上線前請在 Neon SQL Editor 演練（BEGIN … ROLLBACK）後再正式執行。

CREATE TABLE IF NOT EXISTS "platform_title_variant_events" (
  "id" serial PRIMARY KEY,
  "userId" integer NOT NULL,
  "topicId" text NOT NULL,
  "variantId" varchar(32) NOT NULL,
  "kind" varchar(16) NOT NULL,
  "createdAt" timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_title_variant_events_topic_idx"
  ON "platform_title_variant_events" ("topicId");

CREATE INDEX IF NOT EXISTS "platform_title_variant_events_topic_kind_idx"
  ON "platform_title_variant_events" ("topicId", "kind");
