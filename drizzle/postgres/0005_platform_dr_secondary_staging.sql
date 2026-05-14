-- DR-Pro 雙條副選題暫存（Neon）：入隊寫入、任務結案刪除。可與 server/db ensure 並用。
CREATE TABLE IF NOT EXISTS "platform_dr_secondary_staging" (
  "jobId"               varchar(64) PRIMARY KEY,
  "userId"              integer NOT NULL,
  "primarySceneId"      text NOT NULL,
  "secondarySceneId"    text NOT NULL,
  "secondaryTopicHook"  text NOT NULL,
  "secondaryContext"    text NOT NULL,
  "createdAt"           timestamp NOT NULL DEFAULT now()
);
