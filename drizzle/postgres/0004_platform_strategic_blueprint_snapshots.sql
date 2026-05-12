-- Platform 頁 Stage2 選題快照：Neon 部署前於 Console 演練（BEGIN…ROLLBACK）後執行。
CREATE TABLE IF NOT EXISTS "platform_strategic_blueprint_snapshots" (
  "id"            serial PRIMARY KEY,
  "userId"        integer NOT NULL,
  "windowDays"    integer NOT NULL DEFAULT 15,
  "platformsKey"  text NOT NULL DEFAULT '',
  "contextSnippet" text NOT NULL DEFAULT '',
  "blueprintsJson" text NOT NULL,
  "createdAt"     timestamp NOT NULL DEFAULT now(),
  "updatedAt"     timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "platform_strategic_blueprint_snapshots_user_updated_idx"
  ON "platform_strategic_blueprint_snapshots" ("userId", "updatedAt" DESC);
