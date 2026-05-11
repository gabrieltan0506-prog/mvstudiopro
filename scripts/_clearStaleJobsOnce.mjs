/**
 * 一次性：**DELETE** 過舊的 jobs（與 `server/jobs/staleJobsReaper.ts` 規則對齊）。
 *
 * 預設：**20 分鐘**（`JOBS_STALE_MINUTES` 可覆寫）
 * - running：僅「updatedAt」早於門檻即刪（長任務有進度刷新即保留）
 * - queued：「createdAt」早於門檻即刪
 *
 * 使用：`node scripts/_clearStaleJobsOnce.mjs`
 * 讀 `.env.local` 的 `DATABASE_URL`；可 `JOBS_STALE_MINUTES=30` 等。
 */
import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, "..", ".env.local"), quiet: true });

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL missing in .env.local");
  process.exit(1);
}

const rawM = Number(process.env.JOBS_STALE_MINUTES);
const STALE_MIN = Number.isFinite(rawM) ? Math.max(5, Math.min(10080, Math.floor(rawM))) : 20;

const sql = neon(url);

const preview = await sql`
  SELECT status, type::text, COUNT(*)::int AS c
  FROM jobs
  GROUP BY status, type
  ORDER BY status, type
`;
console.log("--- jobs by status+type ---");
console.table(preview);
console.log(`--- stale threshold: ${STALE_MIN} minutes (JOBS_STALE_MINUTES) ---`);

const oldQueued = await sql`
  SELECT id, status, type::text AS type, "createdAt"
  FROM jobs
  WHERE status = 'queued'
    AND "createdAt" < NOW() - (${STALE_MIN} * INTERVAL '1 minute')
  ORDER BY "createdAt" ASC
  LIMIT 50
`;
console.log(`--- stale queued (createdAt older than ${STALE_MIN}m), sample ---`);
console.table(oldQueued);

const staleRun = await sql`
  SELECT id, status, type::text AS type, "createdAt", "updatedAt"
  FROM jobs
  WHERE status = 'running'
    AND "updatedAt" < NOW() - (${STALE_MIN} * INTERVAL '1 minute')
  ORDER BY "updatedAt" ASC
  LIMIT 50
`;
console.log(`--- stale running (updatedAt older than ${STALE_MIN}m, no activity), sample ---`);
console.table(staleRun);

const delQ = await sql`
  DELETE FROM jobs
  WHERE status = 'queued'
    AND "createdAt" < NOW() - (${STALE_MIN} * INTERVAL '1 minute')
  RETURNING id
`;
const delR = await sql`
  DELETE FROM jobs
  WHERE status = 'running'
    AND "updatedAt" < NOW() - (${STALE_MIN} * INTERVAL '1 minute')
  RETURNING id
`;

console.log("--- deleted queued rows:", delQ.length);
console.log("--- deleted running rows:", delR.length);
