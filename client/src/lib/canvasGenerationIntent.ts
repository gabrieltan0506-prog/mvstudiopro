/**
 * 生成意图（generation intent）：标识**这一次生成**，与「用户批准了这份输入」分开。
 *
 * ── 为什么要把它从确认里拆出来（0915 D 施工第二步）──
 * 现状里这两件事被同一把 `submissionKey` 混着表达，而那把键是
 * `newWanSubmissionKey()` **每次调用新随机**（canvasRunBlock.ts:2570 / 1335），
 * 且**发送前不落盘**。后果是服务端两道保护全部落空：
 *   - `createCanvasVideoTask` 的 `fs.link` 映射排他（canvasVideoTask.ts:1385-1418）
 *   - `deductCreditsAmount` 的 `chargeKey` 数据库原子扣费（server/credits.ts）
 * 它们都**只在同键时生效**；客户端每次给新键，等于两道闸都用不上。
 *
 * 职责切分（审查第 4 条钉死）：
 *   - **确认指纹** `ManhuaOutboundConfirmation.fingerprint`：证明用户批准了这份**实际输入**。
 *     换输入、换账号、换工作区、epoch 自增 → 失效，必须重新确认。
 *   - **生成意图 ID**（本模块）：标识这一次生成。网络重试、重复点击、刷新恢复
 *     **必须复用**同一个意图；只有用户**明确再次生成**才创建新意图——
 *     哪怕输入一模一样，那也是一次合法的新任务。
 *
 * 另一条边界（审查第 4 条）：**恢复任务 ≠ 恢复生成批准**。
 * 本模块存的意图/摘要/归属只用于把本地节点**关联**回服务端任务；
 * 查询已提交任务的授权依据是「登录 + 服务端所有权校验」，不是这里的记录。
 * 把旧确认从磁盘读回来就自动允许新提交是错的，本模块**不提供**那种能力：
 * 它不持有确认指纹，也无法被用来给新提交盖章。
 *
 * 本文件是纯函数 + 存储适配，无 React、无网络。
 */

import { z } from "zod";

/** 存储键：与画布本体 `mv-freeform-canvas-v1` 分开，避免整份画布写入时被覆盖 */
export const CANVAS_GENERATION_INTENT_LS_KEY = "mv-canvas-generation-intent-v1";

/** 单节点最多保留的历史意图数（用户多次明确再生成会累积） */
export const CANVAS_INTENT_MAX_PER_BLOCK = 8;

/**
 * 意图归属。字段与 `CanvasOutboundConfirmationScope` 的前四项同名同义，
 * 但**不含 epoch**：epoch 管的是「在途确认失效」，而意图要能跨刷新活下来。
 * 刷新后 epoch 会变，若把它写进归属，恢复时就永远对不上。
 */
export const canvasIntentOwnerSchema = z
  .object({
    userId: z.union([z.string(), z.number()]).transform((v) => String(v)),
    workspaceId: z.string().trim().min(1).max(200),
    blockId: z.string().trim().min(1).max(200),
  })
  .strict();
export type CanvasIntentOwner = z.infer<typeof canvasIntentOwnerSchema>;

/** 意图状态。**未知不等于失败**（审查第 4 条 / 用户第四步） */
export const canvasIntentStatusSchema = z.enum([
  /** 已落盘、还没发出去 */
  "pending_submit",
  /** 已发出，等回执 */
  "submitted",
  /** 拿到了服务端任务号 */
  "acknowledged",
  /** 服务端已明确终态（成功/失败都算，明细在任务侧） */
  "settled",
  /** 发过但状态问不出来：**禁止自动重建**，等核实 */
  "unverified",
]);
export type CanvasIntentStatus = z.infer<typeof canvasIntentStatusSchema>;

export const canvasGenerationIntentSchema = z
  .object({
    /** 意图 ID：这一次生成的身份，重试/刷新复用它 */
    intentId: z.string().trim().min(8).max(120),
    owner: canvasIntentOwnerSchema,
    /**
     * 服务端规范化请求摘要的**客户端副本**。
     * ⚠️ 只用于本地展示与「同意图换输入」的**早期提示**；
     * 审查第 3 条：客户端指纹不能当服务端事实，真正的冲突裁决必须在服务端
     * 的原子意图占位处比对服务端自己算的摘要。
     */
    requestDigest: z.string().trim().min(1).max(200),
    status: canvasIntentStatusSchema,
    /** 服务端任务号，拿到后回填 */
    taskId: z.string().trim().max(200).optional(),
    engine: z.string().trim().max(80).optional(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
  })
  .strict();
export type CanvasGenerationIntent = z.infer<typeof canvasGenerationIntentSchema>;

/** 落盘结构：blockId → 意图列表（新的在后） */
export const canvasIntentStoreSchema = z
  .object({
    format: z.literal(CANVAS_GENERATION_INTENT_LS_KEY),
    byBlock: z.record(z.string(), z.array(canvasGenerationIntentSchema).max(CANVAS_INTENT_MAX_PER_BLOCK)),
  })
  .strict();
export type CanvasIntentStore = z.infer<typeof canvasIntentStoreSchema>;

export const EMPTY_CANVAS_INTENT_STORE: CanvasIntentStore = {
  format: CANVAS_GENERATION_INTENT_LS_KEY,
  byBlock: {},
};

/** 新意图 ID。只在**用户明确再次生成**时调用——重试/刷新一律复用既有意图 */
export function newCanvasIntentId(blockId: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().replace(/-/g, "").slice(0, 20)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
  return `gi_${blockId.replace(/[^0-9a-zA-Z_-]/g, "").slice(0, 40)}_${rand}`;
}

/** 归属是否同一个人同一处。**跨账号绝不复用**（用户第二步） */
export function isSameCanvasIntentOwner(a: CanvasIntentOwner, b: CanvasIntentOwner): boolean {
  return a.userId === b.userId && a.workspaceId === b.workspaceId && a.blockId === b.blockId;
}

/**
 * 找可复用的在途意图。
 *
 * 复用条件：同归属 + 状态尚未结算 + 摘要一致。
 * - 摘要不一致 → **不复用**（同意图换输入是冲突，交给服务端在扣费前裁决）
 * - `settled` → 不复用（那一次已经结束，再生成属于新意图）
 * - `unverified` → **复用**：状态问不出来不等于失败，禁止另起一单
 */
export function findReusableCanvasIntent(
  store: CanvasIntentStore,
  owner: CanvasIntentOwner,
  requestDigest: string,
): CanvasGenerationIntent | null {
  const list = store.byBlock[owner.blockId] || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const it = list[i]!;
    if (!isSameCanvasIntentOwner(it.owner, owner)) continue;
    if (it.status === "settled") continue;
    if (it.requestDigest !== requestDigest) continue;
    return it;
  }
  return null;
}

/**
 * 同归属同节点、状态未结算、但**摘要不同**的在途意图。
 *
 * 用于在发送前给出「这一次的输入与在途那一次不同」的早期提示。
 * ⚠️ 这只是提示：真正的拒绝必须由服务端在扣费之前、
 * 在原子意图占位处用服务端自己算的摘要裁决（审查第 3 条）。
 */
export function findConflictingCanvasIntent(
  store: CanvasIntentStore,
  owner: CanvasIntentOwner,
  requestDigest: string,
): CanvasGenerationIntent | null {
  const list = store.byBlock[owner.blockId] || [];
  for (let i = list.length - 1; i >= 0; i -= 1) {
    const it = list[i]!;
    if (!isSameCanvasIntentOwner(it.owner, owner)) continue;
    if (it.status === "settled") continue;
    if (it.requestDigest === requestDigest) continue;
    return it;
  }
  return null;
}

/** 写入/更新一条意图，返回新 store（纯函数，不碰存储） */
export function upsertCanvasIntent(
  store: CanvasIntentStore,
  intent: CanvasGenerationIntent,
): CanvasIntentStore {
  const list = [...(store.byBlock[intent.owner.blockId] || [])];
  const at = list.findIndex((x) => x.intentId === intent.intentId);
  if (at >= 0) list[at] = intent;
  else list.push(intent);
  // 超出上限时丢最旧的，但**已结算的优先丢**——在途的不能被挤掉
  while (list.length > CANVAS_INTENT_MAX_PER_BLOCK) {
    const settledAt = list.findIndex((x) => x.status === "settled");
    list.splice(settledAt >= 0 ? settledAt : 0, 1);
  }
  return { ...store, byBlock: { ...store.byBlock, [intent.owner.blockId]: list } };
}

/** 按归属找回某节点的在途意图（恢复用）。跨账号查不到——归属不符一律不返回 */
export function listActiveCanvasIntents(
  store: CanvasIntentStore,
  owner: CanvasIntentOwner,
): CanvasGenerationIntent[] {
  return (store.byBlock[owner.blockId] || []).filter(
    (it) => isSameCanvasIntentOwner(it.owner, owner) && it.status !== "settled",
  );
}

/* ────────────────────── 存储适配（并发边界在此显式说明） ────────────────────── */

export type CanvasIntentStorageLike = Pick<Storage, "getItem" | "setItem">;

export function parseCanvasIntentStore(raw: unknown): CanvasIntentStore {
  if (typeof raw !== "string" || !raw.trim()) return EMPTY_CANVAS_INTENT_STORE;
  try {
    const parsed = canvasIntentStoreSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_CANVAS_INTENT_STORE;
  } catch {
    return EMPTY_CANVAS_INTENT_STORE;
  }
}

/** 存储写入失败 —— **必须在发送前阻断**（审查第 5 条），不是警告 */
export class CanvasIntentPersistError extends Error {
  readonly reasonZh: string;
  constructor(reasonZh: string) {
    super(reasonZh);
    this.name = "CanvasIntentPersistError";
    this.reasonZh = reasonZh;
  }
}

/**
 * 读—改—写落盘，并**回读校验**。
 *
 * ── 并发边界（审查第 5 条要求写明，不许含糊）──
 * localStorage 没有 compare-and-swap，本函数的「先读后写」在下面两种情况下
 * **不是**原子的：
 *   1. 同一标签页内的并发调用——由调用方以同步顺序调用来避免（本函数内部不 await）；
 *   2. 多标签页同时写同一节点——后写者会覆盖先写者的列表。
 * 因此本地存储**只作为恢复线索**，不是防重的最终依据：
 * 真正的「同一次生成最多一个任务、最多扣一次费」由服务端
 * `chargeKey` 原子扣费 + 意图占位裁决保证（审查第 1、3 条）。
 *
 * 写完立刻回读并核对 intentId 是否在内：读不回来就抛 `CanvasIntentPersistError`，
 * 让调用方在**发送之前**停下——存不下就等于没有可恢复的意图，宁可不发。
 */
export function persistCanvasIntent(
  storage: CanvasIntentStorageLike,
  intent: CanvasGenerationIntent,
): CanvasIntentStore {
  let current: CanvasIntentStore;
  try {
    current = parseCanvasIntentStore(storage.getItem(CANVAS_GENERATION_INTENT_LS_KEY));
  } catch (e) {
    throw new CanvasIntentPersistError(
      `读取生成记录失败，无法保证重试不会重复下单：${e instanceof Error ? e.message : "未知错误"}`,
    );
  }

  const next = upsertCanvasIntent(current, intent);
  try {
    storage.setItem(CANVAS_GENERATION_INTENT_LS_KEY, JSON.stringify(next));
  } catch (e) {
    throw new CanvasIntentPersistError(
      `本次生成记录存不下（浏览器存储已满或被禁用），为避免重复扣费已中止提交：${
        e instanceof Error ? e.message : "未知错误"
      }`,
    );
  }

  // 回读校验：setItem 不抛不代表真写进去了（隐私模式/配额边界会静默失败）
  const verified = parseCanvasIntentStore(storage.getItem(CANVAS_GENERATION_INTENT_LS_KEY));
  const saved = (verified.byBlock[intent.owner.blockId] || []).some(
    (x) => x.intentId === intent.intentId,
  );
  if (!saved) {
    throw new CanvasIntentPersistError(
      "生成记录写入后读不回来，无法保证重试不会重复下单，已中止提交",
    );
  }
  return verified;
}

export function loadCanvasIntentStore(storage: CanvasIntentStorageLike): CanvasIntentStore {
  try {
    return parseCanvasIntentStore(storage.getItem(CANVAS_GENERATION_INTENT_LS_KEY));
  } catch {
    return EMPTY_CANVAS_INTENT_STORE;
  }
}

/**
 * 取得本次生成要用的意图：能复用就复用，否则新建（**但不落盘**——落盘由调用方
 * 在发送前显式调 `persistCanvasIntent`，好让存储失败能阻断发送）。
 *
 * `forceNew=true` 表示**用户明确再次生成**：即使输入相同也开新意图，
 * 避免「同一份输入永远只能生成一次」的永久去重。
 */
export function resolveCanvasIntentForRun(input: {
  store: CanvasIntentStore;
  owner: CanvasIntentOwner;
  requestDigest: string;
  now: number;
  forceNew?: boolean;
}): { intent: CanvasGenerationIntent; reused: boolean; conflict: CanvasGenerationIntent | null } {
  const conflict = findConflictingCanvasIntent(input.store, input.owner, input.requestDigest);
  if (!input.forceNew) {
    const reusable = findReusableCanvasIntent(input.store, input.owner, input.requestDigest);
    if (reusable) {
      return {
        intent: { ...reusable, updatedAt: input.now },
        reused: true,
        conflict,
      };
    }
  }
  return {
    intent: {
      intentId: newCanvasIntentId(input.owner.blockId),
      owner: input.owner,
      requestDigest: input.requestDigest,
      status: "pending_submit",
      createdAt: input.now,
      updatedAt: input.now,
    },
    reused: false,
    conflict,
  };
}

/* ────────────────────── 与出站确认指纹的衔接 ────────────────────── */

/** FNV-1a 32 位；客户端没有同步 sha，摘要只作本地关联键，不是密码学承诺 */
function fnv1a32(str: string, seed: number): number {
  let h = seed >>> 0;
  for (let i = 0; i < str.length; i += 1) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/**
 * 从出站确认指纹得到**意图摘要**。
 *
 * 指纹是 `JSON.stringify({ engine, scope: { userId, workspaceId, projectVersion, blockId, epoch }, request })`
 * （canvasRunBlock.ts `manhuaOutboundConfirmationFingerprint`）。确认要跟 epoch 走——刷新、
 * 换代都该重新确认；但**意图**不该：刷新之后同一份输入再发，必须复用同一个意图，
 * 否则服务端看到的是"新意图同内容"→ 再建一单再扣一次费。所以这里去掉 epoch 与 projectVersion，
 * 只留「谁、哪个工作区、哪个节点、什么引擎、什么请求」。
 *
 * 解析不了的指纹原样哈希，不猜。
 */
export function canvasIntentDigestFromOutboundFingerprint(fingerprint: string): string {
  let basis = fingerprint;
  try {
    const parsed = JSON.parse(fingerprint) as {
      engine?: unknown;
      request?: unknown;
      scope?: { userId?: unknown; workspaceId?: unknown; blockId?: unknown };
    };
    if (parsed && typeof parsed === "object") {
      basis = JSON.stringify({
        engine: parsed.engine,
        scope: {
          userId: parsed.scope?.userId,
          workspaceId: parsed.scope?.workspaceId,
          blockId: parsed.scope?.blockId,
        },
        request: parsed.request,
      });
    }
  } catch {
    // 非 JSON：直接哈希原串
  }
  const a = fnv1a32(basis, 0x811c9dc5).toString(16).padStart(8, "0");
  const b = fnv1a32(basis, 0x9747b28c).toString(16).padStart(8, "0");
  return `fp_${a}${b}`;
}

/**
 * 回写意图状态（拿到任务号 / 发出 / 未知 / 结算）。**尽力而为，不抛**：
 * 这些回写都发生在 POST 之后，存储失败不能反过来把已发出的请求变成"没发"。
 */
export function markCanvasIntentStatus(
  storage: CanvasIntentStorageLike,
  intentId: string,
  blockId: string,
  patch: { status: CanvasIntentStatus; taskId?: string; engine?: string; now: number },
): CanvasGenerationIntent | null {
  try {
    const store = loadCanvasIntentStore(storage);
    const found = (store.byBlock[blockId] || []).find((x) => x.intentId === intentId);
    if (!found) return null;
    // 终态不回退：已 settled 的不再被迟到的 submitted/acknowledged 改回去
    if (found.status === "settled" && patch.status !== "settled") return found;
    const next: CanvasGenerationIntent = {
      ...found,
      status: patch.status,
      ...(patch.taskId ? { taskId: patch.taskId } : {}),
      ...(patch.engine ? { engine: patch.engine } : {}),
      updatedAt: patch.now,
    };
    storage.setItem(CANVAS_GENERATION_INTENT_LS_KEY, JSON.stringify(upsertCanvasIntent(store, next)));
    return next;
  } catch {
    return null;
  }
}

