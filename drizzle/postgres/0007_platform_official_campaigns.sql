-- 平台官方活动 / 话题征稿策展
CREATE TABLE IF NOT EXISTS "platform_official_campaigns" (
  "id" serial PRIMARY KEY,
  "campaignKey" varchar(80) NOT NULL UNIQUE,
  "platform" varchar(32) NOT NULL,
  "name" text NOT NULL,
  "kind" varchar(32) NOT NULL DEFAULT 'topic_challenge',
  "category" varchar(48) NOT NULL DEFAULT 'summer_lifestyle',
  "featured" boolean NOT NULL DEFAULT true,
  "personaFit" text NOT NULL DEFAULT '',
  "topicHooksJson" text NOT NULL DEFAULT '[]',
  "laneHintsJson" text NOT NULL DEFAULT '[]',
  "summary" text NOT NULL DEFAULT '',
  "status" varchar(16) NOT NULL DEFAULT 'active',
  "sourceNote" text NOT NULL DEFAULT '',
  "reviewedAt" varchar(32) NOT NULL DEFAULT '',
  "createdAt" timestamp NOT NULL DEFAULT now(),
  "updatedAt" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_official_campaigns_platform_featured_idx"
  ON "platform_official_campaigns" ("platform", "featured", "status");
