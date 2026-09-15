/**
 * 服务端生成意图生命周期：**在扣费之前**裁决「这一次生成该不该建单」。
 *
 * ── 为什么要有这一层（0915 D 施工单第 4 节）──
 * 现状 `findCanvasVideoTaskByIdemKey`（canvasVideoTask.ts）把
 * 读失败、映射损坏、任务文件缺失、真的不存在**全部 catch 成 `null`**，
 * 调用方只能理解成「没有任务，可以新建」——于是：
 *   - 磁盘瞬时读错 → 当成没有 → 再建一单 → 再扣一次费
 *   - 赢家写完映射、任务文件还没落地 → 输家当成没有 → 补建
 * 本模块把这几种情况**分成不同结果**，让调用方按各自语义处理。
 *
 * 职责边界：
 *   - 只做「同 user + 同 intentId」的占位与裁决，不碰余额。
 *     真正的扣费仍走 `server/credits.ts` 的 `chargeKey` 原子合同（不重写）。
 *   - 摘要由**服务端**从实际请求算；客户端摘要只作早期提示，不作事实。
 *   - 不判断用户是否批准生成——那是出站确认闸的事，与本模块无关。
 *
 * 存储（0915 用户拍板改数据库，见 canvasIntentStore.ts）：
 *   占位与接管都是**单语句** SQL（唯一索引 + RETURNING / 条件 UPDATE），跨实例有效。
 *   数据库不可用一律 `unreadable`（fail-closed），**不回退文件实现**。
 */

import { createHash, randomUUID } from "crypto";
import {
  type CanvasIntentRow,
  type CanvasIntentStage,
  type CanvasIntentStore,
  getDefaultCanvasIntentStore,
} from "./canvasIntentStore";

export type { CanvasIntentStage } from "./canvasIntentStore";

/** 记录格式版本；破坏性改动必须升版 */
export const CANVAS_INTENT_RECORD_FORMAT = "mv-canvas-intent-v1" as const;

export type CanvasIntentRecord = CanvasIntentRow & {
  format: typeof CANVAS_INTENT_RECORD_FORMAT;
};

/** 租约时长：够一次扣费+建单，不够就必须显式续租 */
export const CANVAS_INTENT_LEASE_MS = 60_000;

/** 本次执行体标识：进程 + 随机；接管判定与续租都认它 */
export function newCanvasIntentHolderId(): string {
  return `h_${process.pid}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** 生成预留任务号；格式须通过 createCanvasVideoTask 的校验 `^cv_[a-z0-9_-]{8,160}$` */
export function reserveCanvasTaskId(): string {
  return `cv_${Date.now().toString(36)}_${randomUUID().replace(/-/g, "").slice(0, 12)}`;
}

/** 裁决结果。**每一种都有自己的处理方式，不许合并成 null** */
export type CanvasIntentDecision =
  /** 本请求抢到了创建权：继续扣费 → 建单（用 record.taskId）→ task_created */
  | { kind: "acquired"; record: CanvasIntentRecord }
  /**
   * 原持有者租约**确已过期**，本请求凭新 holderId 接管。
   * 扣费仍走同一 chargeKey——`chargeCanvasVideoCredits` 按 marker 幂等，不会二扣。
   * **不是靠等几秒猜它崩了**：租约是可验证凭据，而且接管是数据库条件 UPDATE，
   * 两个接管者同时到只有一个 UPDATE 影响到行。
   */
  | { kind: "took_over"; record: CanvasIntentRecord; previousHolderId: string }
  /** 同意图同摘要、任务已存在：直接返回原任务，零扣费零上游提交 */
  | { kind: "existing_task"; record: CanvasIntentRecord; taskId: string }
  /**
   * 同意图同摘要，别人正在创建且**租约仍有效**（占位在、任务未出）。
   * **不得补建、不得接管**——赢家可能只是慢，不一定崩了。
   * 调用方应返回「可查询」状态让客户端继续核实。
   */
  | { kind: "creating"; record: CanvasIntentRecord; leaseExpiresAt: string }
  /**
   * 同意图**不同摘要**：冲突。必须在**扣费之前**返回 409，且零扣费。
   * 不覆盖原记录——原任务还在，用户换了输入就该走新意图。
   */
  | { kind: "conflict"; record: CanvasIntentRecord; expectedDigest: string }
  /**
   * 已扣费但任务还没建出来（上一次崩在中间）。
   * 调用方须凭 `chargeKey` 核既有扣费后继续建单，**不得二扣**。
   */
  | { kind: "charged_pending_task"; record: CanvasIntentRecord }
  /**
   * 记录存在但读不出来／内容损坏／数据库不可用。
   * **绝不能当成「不存在」放行新建**——那正是重复扣费的来源。
   * 调用方应返回可重试错误，让人或后续请求去核实。
   */
  | { kind: "unreadable"; reasonZh: string };

/* ────────────────────────── 摘要 ────────────────────────── */

/** 规范化请求摘要：对象键递归排序，数组次序保留（引用顺序有语义） */
export function canonicalizeForDigest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeForDigest);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) {
      if (src[k] === undefined) continue;
      out[k] = canonicalizeForDigest(src[k]);
    }
    return out;
  }
  return value;
}

/**
 * 服务端请求摘要。
 *
 * 口径是**黑名单**：除了每次都变的非语义字段，其余全部计入——
 * 与出站确认指纹同一思路（canvasRunBlock.ts 的
 * `OUTBOUND_FINGERPRINT_EXCLUDED_KEYS`）。按白名单挑字段必然漏，
 * 漏掉的那个字段改了就成了「同摘要不同内容」，去重会把两次不同生成当成一次。
 */
export const INTENT_DIGEST_EXCLUDED_KEYS = new Set([
  "idempotencyKey",
  "intentId",
  "requestId",
  "clientDigest",
]);

function digestOf(body: Record<string, unknown>, excluded: ReadonlySet<string>): string {
  const filtered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (excluded.has(k)) continue;
    if (v === undefined) continue;
    filtered[k] = v;
  }
  return createHash("sha256")
    .update(JSON.stringify(canonicalizeForDigest(filtered)))
    .digest("hex")
    .slice(0, 48);
}

export function computeServerRequestDigest(body: Record<string, unknown>): string {
  return digestOf(body, INTENT_DIGEST_EXCLUDED_KEYS);
}

/**
 * 建单输入摘要：给 `createCanvasVideoTask` 的那份对象去掉**与内容无关**的字段。
 * 计费快照、任务号、标签是派生/分配的，不是用户输入；其余（提示词、引用、时长、
 * 分辨率、模式、引擎、seed、试片元数据…）全部计入。各建单点按各自真实 body 算，
 * 不套同一个模型格式。
 */
export const CANVAS_TASK_DIGEST_EXCLUDED_KEYS = new Set([
  // 本仓 target 低于 es2015，Set 不能 spread（B 线曾撞 BigInt 同类问题）
  ...Array.from(INTENT_DIGEST_EXCLUDED_KEYS),
  "userId",
  "creditsCharged",
  "deduct",
  "taskId",
  "label",
]);

export function computeCanvasTaskInputDigest(taskInput: Record<string, unknown>): string {
  return digestOf(taskInput, CANVAS_TASK_DIGEST_EXCLUDED_KEYS);
}

/* ────────────────────────── 生命周期 ────────────────────────── */

function withFormat(row: CanvasIntentRow): CanvasIntentRecord {
  return { ...row, format: CANVAS_INTENT_RECORD_FORMAT };
}

async function storeOf(store?: CanvasIntentStore): Promise<CanvasIntentStore> {
  return store ?? (await getDefaultCanvasIntentStore());
}

/**
 * 续租。长操作（扣费、建单、等上游）期间必须调用，否则租约到期会被别人接管。
 * 持有者不符时**不续**——CAS 谓词里带 holderId，非持有者的 UPDATE 影响 0 行。
 */
export async function renewCanvasIntentLease(input: {
  store?: CanvasIntentStore;
  userId: number;
  intentId: string;
  holderId: string;
  now?: () => number;
  leaseMs?: number;
}): Promise<CanvasIntentRecord | null> {
  const store = await storeOf(input.store);
  const clock = input.now ?? (() => Date.now());
  const res = await store.casUpdate({
    userId: input.userId,
    intentId: input.intentId,
    expectHolderId: input.holderId,
    patch: {
      leaseExpiresAt: new Date(clock() + (input.leaseMs ?? CANVAS_INTENT_LEASE_MS)).toISOString(),
      updatedAt: new Date(clock()).toISOString(),
    },
  });
  return res.kind === "updated" ? withFormat(res.row) : null;
}

/**
 * 原子占位并裁决。**必须在扣费之前调用**。
 *
 * 占位 = `INSERT … ON CONFLICT DO NOTHING RETURNING`（赢家有行）；
 * 输家再读一次做裁决；接管 = 带租约谓词的条件 UPDATE。
 */
export async function acquireCanvasIntent(input: {
  store?: CanvasIntentStore;
  userId: number;
  intentId: string;
  operation: string;
  requestDigest: string;
  /** 本次执行体标识；接管判定与续租都认它 */
  holderId: string;
  /**
   * 调用方已在别处预留的任务号（试片 registry 在扣费前预留）。
   * 给了就沿用，不再另造——否则试片的预留号与这里的预留号会分裂成两个任务。
   */
  reservedTaskId?: string;
  /** 便于测试注入时钟；生产不传 */
  now?: () => number;
  leaseMs?: number;
}): Promise<CanvasIntentDecision> {
  const store = await storeOf(input.store);
  const clock = input.now ?? (() => Date.now());
  const leaseMs = input.leaseMs ?? CANVAS_INTENT_LEASE_MS;
  const stamp = new Date(clock()).toISOString();
  const row: CanvasIntentRow = {
    intentId: input.intentId,
    userId: input.userId,
    operation: input.operation,
    requestDigest: input.requestDigest,
    stage: "reserved",
    // 占位时就定号：charged_pending_task 恢复时才能回到**同一个**任务
    taskId: String(input.reservedTaskId || "").trim() || reserveCanvasTaskId(),
    holderId: input.holderId,
    leaseExpiresAt: new Date(clock() + leaseMs).toISOString(),
    createdAt: stamp,
    updatedAt: stamp,
  };

  const inserted = await store.insertIfAbsent(row);
  if (inserted.kind === "inserted") return { kind: "acquired", record: withFormat(row) };
  if (inserted.kind === "unreadable") return inserted;

  // 输家：读既有记录裁决
  const found = await store.get(input.userId, input.intentId);
  if (found.kind === "unreadable") return found;
  if (found.kind === "none") {
    // 插入说已存在、读却说没有（并发删除/复制延迟）：**不当作可新建**
    return { kind: "unreadable", reasonZh: "生成记录状态不确定，请稍后重试" };
  }

  const existing = found.row;
  if (existing.userId !== input.userId) {
    // 归属不符：不泄露他人任务，也不放行新建
    return { kind: "unreadable", reasonZh: "生成记录归属不符" };
  }
  if (existing.requestDigest !== input.requestDigest) {
    return { kind: "conflict", record: withFormat(existing), expectedDigest: existing.requestDigest };
  }
  if (existing.stage === "task_created" && existing.taskId) {
    return { kind: "existing_task", record: withFormat(existing), taskId: existing.taskId };
  }
  const nowIso = new Date(clock()).toISOString();
  const leaseAlive = Date.parse(existing.leaseExpiresAt) > clock();

  if (existing.stage === "charged") {
    // 已扣费未建单。**恢复者必须先拿到持有权**，否则它后面的 charged CAS（fencing）会失败，
    // 谁都建不了单、任务永远卡住——离线四层计数测试 #8 抓出来的真缺陷。
    if (existing.holderId === input.holderId) {
      // 同一执行体重入（同进程重试）：直接继续
      return { kind: "charged_pending_task", record: withFormat(existing) };
    }
    if (leaseAlive) {
      // 原持有者可能正要建单：不抢，让客户端按意图查询
      return { kind: "creating", record: withFormat(existing), leaseExpiresAt: existing.leaseExpiresAt };
    }
    const taken = await store.casUpdate({
      userId: input.userId,
      intentId: input.intentId,
      expectHolderId: existing.holderId,
      requireLeaseExpiredBefore: nowIso,
      patch: { holderId: input.holderId, leaseExpiresAt: new Date(clock() + leaseMs).toISOString(), updatedAt: nowIso },
    });
    if (taken.kind === "updated") return { kind: "charged_pending_task", record: withFormat(taken.row) };
    if (taken.kind === "unreadable") return taken;
    const again = await store.get(input.userId, input.intentId);
    if (again.kind === "ok") {
      return { kind: "creating", record: withFormat(again.row), leaseExpiresAt: again.row.leaseExpiresAt };
    }
    return { kind: "unreadable", reasonZh: "生成记录状态不确定，请稍后重试" };
  }

  if (leaseAlive) {
    // reserved 且租约有效：别人可能只是慢——**不补建、不接管**
    return { kind: "creating", record: withFormat(existing), leaseExpiresAt: existing.leaseExpiresAt };
  }

  // reserved 且租约**看起来**已过期：用条件 UPDATE 接管——谓词里带原 holderId 与租约时刻，
  // 两个接管者同时到、或原持有者刚续租，只有一个 UPDATE 命中
  const taken = await store.casUpdate({
    userId: input.userId,
    intentId: input.intentId,
    expectHolderId: existing.holderId,
    requireLeaseExpiredBefore: nowIso,
    patch: {
      holderId: input.holderId,
      leaseExpiresAt: new Date(clock() + leaseMs).toISOString(),
      updatedAt: nowIso,
    },
  });
  if (taken.kind === "updated") {
    return { kind: "took_over", record: withFormat(taken.row), previousHolderId: existing.holderId };
  }
  if (taken.kind === "unreadable") return taken;
  // CAS 没命中：要么别人先接管了，要么原持有者续了租。保守按 creating 处理，不猜
  const again = await store.get(input.userId, input.intentId);
  if (again.kind === "ok") {
    return { kind: "creating", record: withFormat(again.row), leaseExpiresAt: again.row.leaseExpiresAt };
  }
  return { kind: "unreadable", reasonZh: "生成记录状态不确定，请稍后重试" };
}

/** 更新占位阶段（扣费后 / 建单后各调一次），供崩溃恢复凭据 */
export async function updateCanvasIntentStage(input: {
  store?: CanvasIntentStore;
  userId: number;
  intentId: string;
  stage: CanvasIntentStage;
  /** 必须是当前持有者；被接管后旧持有者写不进来（防止迟到的赢家覆盖接管者） */
  holderId: string;
  chargeKey?: string;
  now?: () => number;
  leaseMs?: number;
}): Promise<CanvasIntentRecord | null> {
  const store = await storeOf(input.store);
  const clock = input.now ?? (() => Date.now());
  // holderId 校验在 SQL 谓词里：租约过期被接管后，原持有者的迟到 UPDATE 影响 0 行。
  // **taskId 不可改**：它在占位时就定了，改了就等于同一次生成换了任务——patch 里根本没有它。
  const res = await store.casUpdate({
    userId: input.userId,
    intentId: input.intentId,
    expectHolderId: input.holderId,
    patch: {
      stage: input.stage,
      ...(input.chargeKey ? { chargeKey: input.chargeKey } : {}),
      leaseExpiresAt: new Date(clock() + (input.leaseMs ?? CANVAS_INTENT_LEASE_MS)).toISOString(),
      updatedAt: new Date(clock()).toISOString(),
    },
  });
  return res.kind === "updated" ? withFormat(res.row) : null;
}

/**
 * 按意图查既有记录（恢复用）。
 *
 * **查询已提交任务不需要重新批准生成**（审查第 4 条）：
 * 授权依据是调用方传进来的、已由服务端登录态校验过的 `userId`，
 * 归属不符一律不返回——不泄露他人任务。
 * 读不出来时返回 `unreadable`，**不返回 null**，免得调用方当成「没有」。
 */
export async function lookupCanvasIntent(input: {
  store?: CanvasIntentStore;
  userId: number;
  intentId: string;
}): Promise<
  | { kind: "none" }
  | { kind: "ok"; record: CanvasIntentRecord }
  | { kind: "unreadable"; reasonZh: string }
> {
  const store = await storeOf(input.store);
  const found = await store.get(input.userId, input.intentId);
  if (found.kind === "ok") {
    if (found.row.userId !== input.userId) return { kind: "none" };
    return { kind: "ok", record: withFormat(found.row) };
  }
  return found;
}

/* ────────────────────────── 给 api/jobs 建单点用的纯映射 ────────────────────────── */

/**
 * 把裁决结果翻成「继续 / 直接回复」。纯函数，不碰 res，不碰任务文件。
 *
 * - acquired / took_over / charged_pending_task → 继续：扣费（按 marker 幂等）→ 建单用 record.taskId
 * - existing_task → 回既有任务（调用方按 taskId 取任务载荷，与其他「existing」返回同形）
 * - creating → 202 可查询，客户端按 intentId 继续核实，**不诱导重新生成**
 * - conflict → 409 零扣费
 * - unreadable → 503 可重试
 */
export type CanvasIntentJobStep =
  | { proceed: true; taskId: string; record: CanvasIntentRecord; recovered: boolean }
  | { proceed: false; kind: "existing_task"; taskId: string; intentId: string }
  | { proceed: false; kind: "reply"; status: number; body: Record<string, unknown> };

export function planCanvasIntentJobStep(
  decision: CanvasIntentDecision,
  intentId: string,
): CanvasIntentJobStep {
  switch (decision.kind) {
    case "acquired":
      return { proceed: true, taskId: decision.record.taskId, record: decision.record, recovered: false };
    case "took_over":
    case "charged_pending_task":
      return { proceed: true, taskId: decision.record.taskId, record: decision.record, recovered: true };
    case "existing_task":
      return { proceed: false, kind: "existing_task", taskId: decision.taskId, intentId };
    case "creating":
      return {
        proceed: false,
        kind: "reply",
        status: 202,
        body: {
          ok: true,
          async: true,
          pending: true,
          intentId,
          status: "creating",
          leaseExpiresAt: decision.leaseExpiresAt,
          message: "同一次生成正在创建中，请稍候查询结果；本次未重复扣费",
        },
      };
    case "conflict":
      return {
        proceed: false,
        kind: "reply",
        status: 409,
        body: {
          ok: false,
          code: "intent_conflict",
          intentId,
          error: "本次输入与在途那一次生成不同，未扣费。请重新查看生成前确认后再次生成",
        },
      };
    case "unreadable":
      return {
        proceed: false,
        kind: "reply",
        status: 503,
        body: { ok: false, code: "intent_unreadable", intentId, error: decision.reasonZh },
      };
  }
}
