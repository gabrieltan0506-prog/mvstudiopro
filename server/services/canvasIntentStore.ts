/**
 * 生成意图占位的存储层：**单语句原子**的插入 / 读取 / 条件更新。
 *
 * ── 为什么从文件 `fs.link` 换成数据库（0915 用户拍板）──
 * `fs.link` 的排他只在**同一文件系统**内成立。Fly 多实例是否挂同一卷无法证明，
 * 而扣费是全局的：两台机器各自"赢"一次占位 = 同一次生成扣两次费。
 * 数据库唯一索引 + `RETURNING` 是跨实例的，与 `stripe_usage_logs.chargeKey`
 * 唯一索引（credits.ts）同一道防线。
 *
 * neon-http **没有跨语句事务**，所以这里每个操作都是一条 SQL：
 *   - 占位：`INSERT … ON CONFLICT DO NOTHING RETURNING`（有行=赢家，无行=已存在）
 *   - 接管/推进：`UPDATE … WHERE holderId = 期望值 [AND 租约已过期] RETURNING`（CAS）
 * JS 里**不**做"先读再判再写"——那正是并发双扣的老病根。
 *
 * 数据库不可用、表未就绪、SQL 报错 → 一律 `unreadable`，**不回退文件实现**：
 * 回退等于把跨实例漏洞重新打开，只为让请求"看起来能过"。fail-closed。
 */

import { sql } from "drizzle-orm";
import { getDb, isCanvasIntentTableReady, reverifyCanvasIntentTable } from "../db";

export type CanvasIntentStage =
  /** 刚占到位，还没扣费 */
  | "reserved"
  /** 已扣费，任务还没建出来（崩在这里要能凭 chargeKey 恢复，不能二扣） */
  | "charged"
  /** 任务已建出，taskId 已知 */
  | "task_created";

export type CanvasIntentRow = {
  intentId: string;
  userId: number;
  operation: string;
  /** 服务端算的规范化请求摘要 */
  requestDigest: string;
  stage: CanvasIntentStage;
  /** 扣费幂等键；扣费后写入，供崩溃恢复时核既有扣费 */
  chargeKey?: string;
  /** 占位时就预留的任务号（见 canvasGenerationIntent.ts 的说明） */
  taskId: string;
  /** 当前持有创建权的执行体标识 */
  holderId: string;
  /** 租约到期（ISO） */
  leaseExpiresAt: string;
  createdAt: string;
  updatedAt: string;
};

export type CanvasIntentStoreRead =
  | { kind: "none" }
  | { kind: "ok"; row: CanvasIntentRow }
  | { kind: "unreadable"; reasonZh: string };

export type CanvasIntentStoreInsert =
  | { kind: "inserted" }
  | { kind: "exists" }
  | { kind: "unreadable"; reasonZh: string };

export type CanvasIntentStoreUpdate =
  | { kind: "updated"; row: CanvasIntentRow }
  /** holderId 不符 / 租约未过期 / 记录不存在——都不是错误，是 CAS 没命中 */
  | { kind: "no_match" }
  | { kind: "unreadable"; reasonZh: string };

export type CanvasIntentCasPatch = {
  stage?: CanvasIntentStage;
  chargeKey?: string;
  holderId?: string;
  leaseExpiresAt: string;
  updatedAt: string;
};

export interface CanvasIntentStore {
  insertIfAbsent(row: CanvasIntentRow): Promise<CanvasIntentStoreInsert>;
  get(userId: number, intentId: string): Promise<CanvasIntentStoreRead>;
  /**
   * 单语句 CAS。只有 `holderId === expectHolderId`（且若给了
   * `requireLeaseExpiredBefore`，还要 `leaseExpiresAt < 它`）才更新。
   */
  casUpdate(input: {
    userId: number;
    intentId: string;
    expectHolderId: string;
    requireLeaseExpiredBefore?: string;
    patch: CanvasIntentCasPatch;
  }): Promise<CanvasIntentStoreUpdate>;
}

/* ────────────────────────── 内存实现（测试与离线对照） ────────────────────────── */

export type MemoryCanvasIntentFaults = {
  /** 返回非 undefined 即替换真实读结果——用于注入「读不出来」 */
  get?: (key: string) => CanvasIntentStoreRead | undefined;
  insert?: (key: string) => CanvasIntentStoreInsert | undefined;
  casUpdate?: (key: string) => CanvasIntentStoreUpdate | undefined;
};

/**
 * 内存版。每个操作先 `await` 让出一次事件循环再做**同步**读改写：
 * 并发调用会在 await 处交错，然后各自原子地执行——与数据库
 * "多个请求同时到达、逐条串行执行" 的语义一致，十路并发只有一个赢家。
 *
 * ⚠️ 它证明的是**裁决逻辑**在原子存储上的正确性，
 * 不证明 Postgres 本身的原子性——那由唯一索引与 RETURNING 保证，见 pg 实现的 SQL 形状测试。
 */
export class MemoryCanvasIntentStore implements CanvasIntentStore {
  private rows = new Map<string, CanvasIntentRow>();
  faults: MemoryCanvasIntentFaults = {};

  private key(userId: number, intentId: string): string {
    return `${userId}:${intentId}`;
  }

  async insertIfAbsent(row: CanvasIntentRow): Promise<CanvasIntentStoreInsert> {
    await Promise.resolve();
    const k = this.key(row.userId, row.intentId);
    const injected = this.faults.insert?.(k);
    if (injected) return injected;
    if (this.rows.has(k)) return { kind: "exists" };
    this.rows.set(k, { ...row });
    return { kind: "inserted" };
  }

  async get(userId: number, intentId: string): Promise<CanvasIntentStoreRead> {
    await Promise.resolve();
    const k = this.key(userId, intentId);
    const injected = this.faults.get?.(k);
    if (injected) return injected;
    const row = this.rows.get(k);
    return row ? { kind: "ok", row: { ...row } } : { kind: "none" };
  }

  async casUpdate(input: {
    userId: number;
    intentId: string;
    expectHolderId: string;
    requireLeaseExpiredBefore?: string;
    patch: CanvasIntentCasPatch;
  }): Promise<CanvasIntentStoreUpdate> {
    await Promise.resolve();
    const k = this.key(input.userId, input.intentId);
    const injected = this.faults.casUpdate?.(k);
    if (injected) return injected;
    const row = this.rows.get(k);
    if (!row) return { kind: "no_match" };
    if (row.holderId !== input.expectHolderId) return { kind: "no_match" };
    if (
      input.requireLeaseExpiredBefore &&
      !(Date.parse(row.leaseExpiresAt) < Date.parse(input.requireLeaseExpiredBefore))
    ) {
      return { kind: "no_match" };
    }
    const next: CanvasIntentRow = {
      ...row,
      ...(input.patch.stage ? { stage: input.patch.stage } : {}),
      ...(input.patch.chargeKey ? { chargeKey: input.patch.chargeKey } : {}),
      ...(input.patch.holderId ? { holderId: input.patch.holderId } : {}),
      leaseExpiresAt: input.patch.leaseExpiresAt,
      updatedAt: input.patch.updatedAt,
    };
    this.rows.set(k, next);
    return { kind: "updated", row: { ...next } };
  }

  /** 测试用：直接看盘 */
  peek(userId: number, intentId: string): CanvasIntentRow | undefined {
    const row = this.rows.get(this.key(userId, intentId));
    return row ? { ...row } : undefined;
  }
}

/* ────────────────────────── Postgres 实现（生产） ────────────────────────── */

type Db = NonNullable<Awaited<ReturnType<typeof getDb>>>;

function executeRows(res: unknown): Record<string, unknown>[] {
  const rows = (res as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

function isoOf(value: unknown): string {
  if (value instanceof Date) return value.toISOString();
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? String(value) : d.toISOString();
}

const STAGES: ReadonlySet<string> = new Set(["reserved", "charged", "task_created"]);

/** 行 → 记录；字段缺失/类型错就是 unreadable，不猜 */
function rowFromDb(raw: Record<string, unknown>): CanvasIntentRow | null {
  const intentId = String(raw.intentId ?? "");
  const userId = Number(raw.userId);
  const stage = String(raw.stage ?? "");
  const taskId = String(raw.taskId ?? "");
  const holderId = String(raw.holderId ?? "");
  const requestDigest = String(raw.requestDigest ?? "");
  if (!intentId || !Number.isFinite(userId) || !STAGES.has(stage) || !taskId || !holderId || !requestDigest) {
    return null;
  }
  const chargeKey = raw.chargeKey == null ? undefined : String(raw.chargeKey);
  return {
    intentId,
    userId,
    operation: String(raw.operation ?? ""),
    requestDigest,
    stage: stage as CanvasIntentStage,
    ...(chargeKey ? { chargeKey } : {}),
    taskId,
    holderId,
    leaseExpiresAt: isoOf(raw.leaseExpiresAt),
    createdAt: isoOf(raw.createdAt),
    updatedAt: isoOf(raw.updatedAt),
  };
}

function reasonOf(e: unknown, what: string): string {
  const msg = e instanceof Error ? e.message.slice(0, 160) : String(e).slice(0, 160);
  return `生成记录${what}失败（${msg}），为避免重复下单已中止`;
}

export class PgCanvasIntentStore implements CanvasIntentStore {
  constructor(private readonly db: Db) {}

  async insertIfAbsent(row: CanvasIntentRow): Promise<CanvasIntentStoreInsert> {
    try {
      const res = await this.db.execute(sql`
        INSERT INTO "canvas_generation_intents"
          ("intentId", "userId", "operation", "requestDigest", "stage", "chargeKey",
           "taskId", "holderId", "leaseExpiresAt", "createdAt", "updatedAt")
        VALUES
          (${row.intentId}, ${row.userId}, ${row.operation}, ${row.requestDigest}, ${row.stage},
           ${row.chargeKey ?? null}, ${row.taskId}, ${row.holderId},
           ${row.leaseExpiresAt}::timestamptz, ${row.createdAt}::timestamptz, ${row.updatedAt}::timestamptz)
        ON CONFLICT ("userId", "intentId") DO NOTHING
        RETURNING "intentId"
      `);
      return executeRows(res).length ? { kind: "inserted" } : { kind: "exists" };
    } catch (e) {
      return { kind: "unreadable", reasonZh: reasonOf(e, "占位") };
    }
  }

  async get(userId: number, intentId: string): Promise<CanvasIntentStoreRead> {
    try {
      const res = await this.db.execute(sql`
        SELECT "intentId", "userId", "operation", "requestDigest", "stage", "chargeKey",
               "taskId", "holderId", "leaseExpiresAt", "createdAt", "updatedAt"
        FROM "canvas_generation_intents"
        WHERE "userId" = ${userId} AND "intentId" = ${intentId}
        LIMIT 1
      `);
      const rows = executeRows(res);
      if (!rows.length) return { kind: "none" };
      const row = rowFromDb(rows[0]!);
      return row
        ? { kind: "ok", row }
        : { kind: "unreadable", reasonZh: "生成记录内容损坏，为避免重复下单已中止" };
    } catch (e) {
      return { kind: "unreadable", reasonZh: reasonOf(e, "读取") };
    }
  }

  async casUpdate(input: {
    userId: number;
    intentId: string;
    expectHolderId: string;
    requireLeaseExpiredBefore?: string;
    patch: CanvasIntentCasPatch;
  }): Promise<CanvasIntentStoreUpdate> {
    const { patch } = input;
    // 租约条件是 SQL 谓词的一部分：谁先命中谁赢，第二个 UPDATE 影响 0 行
    const leasePredicate = input.requireLeaseExpiredBefore
      ? sql` AND "leaseExpiresAt" < ${input.requireLeaseExpiredBefore}::timestamptz`
      : sql``;
    try {
      const res = await this.db.execute(sql`
        UPDATE "canvas_generation_intents"
        SET "stage" = COALESCE(${patch.stage ?? null}, "stage"),
            "chargeKey" = COALESCE(${patch.chargeKey ?? null}, "chargeKey"),
            "holderId" = COALESCE(${patch.holderId ?? null}, "holderId"),
            "leaseExpiresAt" = ${patch.leaseExpiresAt}::timestamptz,
            "updatedAt" = ${patch.updatedAt}::timestamptz
        WHERE "userId" = ${input.userId}
          AND "intentId" = ${input.intentId}
          AND "holderId" = ${input.expectHolderId}${leasePredicate}
        RETURNING "intentId", "userId", "operation", "requestDigest", "stage", "chargeKey",
                  "taskId", "holderId", "leaseExpiresAt", "createdAt", "updatedAt"
      `);
      const rows = executeRows(res);
      if (!rows.length) return { kind: "no_match" };
      const row = rowFromDb(rows[0]!);
      return row
        ? { kind: "updated", row }
        : { kind: "unreadable", reasonZh: "生成记录内容损坏，为避免重复下单已中止" };
    } catch (e) {
      return { kind: "unreadable", reasonZh: reasonOf(e, "更新") };
    }
  }
}

/** 数据库不可用 / 表未就绪：每个操作都拒绝。**不回退文件实现。** */
export function failClosedCanvasIntentStore(reasonZh: string): CanvasIntentStore {
  const unreadable = { kind: "unreadable" as const, reasonZh };
  return {
    insertIfAbsent: async () => unreadable,
    get: async () => unreadable,
    casUpdate: async () => unreadable,
  };
}

/** 生产默认 store。测试与离线对照请显式传入 MemoryCanvasIntentStore。 */
export async function getDefaultCanvasIntentStore(): Promise<CanvasIntentStore> {
  const db = await getDb();
  if (!db) return failClosedCanvasIntentStore("数据库不可用，生成暂停，请稍后重试");
  if (!isCanvasIntentTableReady() && !(await reverifyCanvasIntentTable())) {
    return failClosedCanvasIntentStore("生成意图表未就绪，生成暂停，请稍后重试");
  }
  return new PgCanvasIntentStore(db);
}
