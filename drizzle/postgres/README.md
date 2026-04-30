# `drizzle/postgres/` — 手写 Postgres migration

## 为什么有这个目录

仓库根目录 `drizzle/` 下的 `0000_*.sql ~ 0011_*.sql` 是**早期 MySQL dialect** 时代留下的残骸（反引号、`int AUTO_INCREMENT`、`enum('a','b')` 等 MySQL 语法），生产 Neon Postgres 上**不能直接执行**。

`drizzle/meta/_journal.json` 里 `"dialect": "mysql"` 也跟当前 `drizzle.config.ts` 里 `dialect: "postgresql"` 不一致 —— migration history 实际上已经断裂。

生产 Neon schema 由历史人工维护（手工 push / Neon Console SQL Editor 执行），不靠 `drizzle-kit migrate`。在彻底修复这个技术债务之前（**不在本 PR 范围**），新增 schema 走本目录手写标准 Postgres SQL。

## 文件清单

| 文件 | 用途 | PR |
|------|------|-----|
| `0001_enterprise_agents.sql` | 创建 3 张企业 Agent 表 + 索引 | PR-1（已合并） |
| `0002_enterprise_agent_kb_full_text.sql` | enterprise_agent_kb 加 `extractedTextFull` 列 | PR-3（本次） |
| `0003_jobs_status_queued_index.sql` | jobs 表新增 `idx_jobs_queued_created` partial index（修 Neon egress 泄漏） | hotfix/egress-optimization |

## 应用流程（生产 Neon）

**强制流程**：在 Neon Console SQL Editor 里**先演练，再正式执行**。

### Step 1 — 演练（DRY RUN）

```sql
BEGIN;

-- 在这里贴入 0001_enterprise_agents.sql 全部内容

-- 验证表结构
\d "enterprise_agents"
\d "enterprise_agent_kb"
\d "enterprise_agent_sessions"

-- 验证索引
SELECT indexname FROM pg_indexes
WHERE tablename IN ('enterprise_agents', 'enterprise_agent_kb', 'enterprise_agent_sessions')
ORDER BY tablename, indexname;

ROLLBACK;
```

如果上面任何一步报错或结果不符预期 → 修 SQL → 再演练。

### Step 2 — 真正执行

```sql
BEGIN;

-- 在这里贴入 0001_enterprise_agents.sql 全部内容

-- 再次跑一遍验证查询确认无误
SELECT count(*) FROM "enterprise_agents";  -- 应该是 0
SELECT count(*) FROM "enterprise_agent_kb";  -- 应该是 0
SELECT count(*) FROM "enterprise_agent_sessions";  -- 应该是 0

COMMIT;
```

> **注意**：所有 SQL 都写了 `IF NOT EXISTS`，理论上重跑无害。但仍建议每次只执行一次，便于审计。

### Step 3 — 应用 0002（PR-3 同步操作）

PR-3 合并前需在 Neon Console 执行以下 SQL（演练 → 正式执行同 Step 1+2 流程）：

```sql
BEGIN;

ALTER TABLE "enterprise_agent_kb"
ADD COLUMN IF NOT EXISTS "extractedTextFull" TEXT;

-- 验证
SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
 WHERE table_name = 'enterprise_agent_kb'
   AND column_name = 'extractedTextFull';
-- 期望：1 行，data_type=text, is_nullable=YES

COMMIT;
```

兼容性：
- 0002 为纯 ADD COLUMN，对已部署 PR-2 代码（不读 extractedTextFull）零影响
- 默认 NULL，无需 backfill
- 上线后 PR-3 代码上传新 KB 文件时会同时写 preview + full 两列

### Step 4 — 应用 0003（hotfix/egress-optimization 同步操作）

0003 只加一个 partial index，**必须用 `CREATE INDEX CONCURRENTLY`** 避免
锁表；`CONCURRENTLY` 在 PostgreSQL 中**不能出现在 transaction block 里**，
所以这一条单独跑，不走 BEGIN/COMMIT：

```sql
-- 直接在 Neon Console SQL Editor 执行（不要包在 BEGIN/COMMIT 里）
CREATE INDEX CONCURRENTLY IF NOT EXISTS "idx_jobs_queued_created"
  ON "jobs" ("createdAt")
  WHERE "status" = 'queued';

-- 验证
SELECT indexname, indexdef FROM pg_indexes
 WHERE tablename = 'jobs' AND indexname = 'idx_jobs_queued_created';
-- 期望：1 行，indexdef 含 "WHERE (status = 'queued'::text)"
```

兼容性：
- 0003 只读 partial index，对已部署代码零影响（未建也会 fallback 到 seq_scan）
- 建完后 worker 下一轮 `claimNextQueuedJob` 即命中 btree，Neon egress
  从全表扫降到 index-only scan

文件 `0003_jobs_status_queued_index.sql` 里保留了不带 CONCURRENTLY 的版本，
仅用于本地 docker / dry-run；**生产 Neon 必须用上面的 CONCURRENTLY 命令**。

## 跟 drizzle ORM 代码的关系

- TypeScript 侧 schema 定义在 `drizzle/schema-enterprise-agents.ts`（pgTable 形式，drizzle-orm 在运行时读取）
- 本目录 `.sql` 文件是 schema 的**物理落地**手册
- 两者必须**手工保持同步**：改 schema TS 后必须同步更新 `drizzle/postgres/` 下对应 SQL
- CI 不会自动校验两者一致 —— 由 reviewer 在 PR diff 里目视检查

## 未来重置 drizzle migration history（不在本 PR 范围）

建议未来开独立技术债务 PR 做：

1. 重置 `drizzle/meta/_journal.json` — `dialect=postgresql`，`entries=[]`
2. 用 `drizzle-kit introspect` 反向生成当前 Neon 真实 schema → `drizzle/0000_baseline.sql`
3. 后续所有 schema 变更走 `drizzle-kit generate` 标准流程
4. 移除/归档旧 `drizzle/0000-0011_*.sql`（MySQL 残骸）
5. 本目录 `drizzle/postgres/` 也可以归档掉

在那之前，**新表 / 新列 / 新索引一律走本目录手写**。
