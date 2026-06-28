-- 投流投后复盘（Neon）：用户回填实测投放数据，算真实 CPA / ROI。可与 server/db ensure 并用。
CREATE TABLE IF NOT EXISTS "paid_traffic_reviews" (
  "id"            serial PRIMARY KEY,
  "userId"        integer NOT NULL,
  "platform"      varchar(32),
  "campaignName"  varchar(255),
  "spend"         numeric(12, 2) NOT NULL,
  "impressions"   integer NOT NULL DEFAULT 0,
  "clicks"        integer NOT NULL DEFAULT 0,
  "conversions"   integer NOT NULL DEFAULT 0,
  "revenue"       numeric(12, 2) NOT NULL DEFAULT '0',
  "notes"         text,
  "measuredAt"    timestamp,
  "createdAt"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "paid_traffic_reviews_user_created_idx"
  ON "paid_traffic_reviews" ("userId", "createdAt" DESC);
