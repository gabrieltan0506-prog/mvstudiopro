/**
 * 图文手册各阶段的动态并发（用户 2026-11-08 令：大文件高并发、小文件低并发，各阶段尽量一到两轮延迟内完成）。
 *
 * - 并发 = clamp(ceil(批次数 / 目标轮数), 下限, 通道上限)。
 * - 通道上限：OpenRouter 已在模板学习实测 10 路同时在途无限流（错峰两波），作为已证下限；EvoLink 用户实测同速，按同级处理。
 *   上限先取 16/通道，靠 429/keyLimit 计数调优；出现限流信号即该通道减半，成功后逐步回升。
 * - 双通道分摊：OpenRouter 份额略大。
 * - 首波错峰：同一通道的后续路数按固定间隔依次发出，避免同一瞬间齐发。
 *
 * 本模块只决定「何时发出下一次」，不改变任何回执、计费或重试语义：已有回执照旧回放，未知回执照旧不重买。
 */
export type KnowledgeModelChannel = "openrouter" | "evolink";
export type KnowledgeImageChannel = "openai" | "evolink";

/** OpenRouter 已证安全并发（模板学习 FlashX 10 路在途无限流）。 */
export const KNOWLEDGE_PROVEN_FLOOR = 10;
/** 每通道在途上限（模型调用）。 */
export const KNOWLEDGE_MODEL_CHANNEL_MAX: Record<KnowledgeModelChannel, number> = { openrouter: 16, evolink: 16 };
/** 每通道在途上限（生图）：用户高额度，16 张一次发完。 */
export const KNOWLEDGE_IMAGE_CHANNEL_MAX: Record<KnowledgeImageChannel, number> = { openai: 16, evolink: 16 };
/** OpenRouter 在双通道分摊中的份额。 */
export const KNOWLEDGE_OPENROUTER_SHARE = 0.6;
/** 同通道首波错峰间隔。 */
export const KNOWLEDGE_STAGGER_MS = 400;

/** 并发 = clamp(ceil(n / 目标轮数), 下限, 上限)；n=0 时为 0。 */
export function knowledgeStageConcurrency(count: number, options: { max: number; targetRounds?: number; min?: number }) {
  const n = Math.max(0, Math.floor(count || 0));
  if (!n) return 0;
  const rounds = Math.max(1, Math.floor(options.targetRounds ?? 1));
  const min = Math.max(1, Math.floor(options.min ?? 1));
  const max = Math.max(1, Math.floor(options.max));
  return Math.min(n, Math.max(Math.min(min, max), Math.min(max, Math.ceil(n / rounds))));
}

/**
 * 双通道路数：总路数按 OpenRouter 份额分摊，各自不超过通道上限，并交错排列（OR、EVO、OR…），
 * 使小批量也两边都有路数，大批量一轮发完。
 */
export function knowledgeChannelLanes<C extends string>(count: number, caps: Record<C, number>, order: readonly C[], firstShare = KNOWLEDGE_OPENROUTER_SHARE): C[] {
  const [a, b] = order as readonly [C, C];
  const total = knowledgeStageConcurrency(count, { max: caps[a] + caps[b] });
  if (!total) return [];
  // 两路以上时两个通道都至少一路。
  let first = Math.min(caps[a], total > 1 ? total - 1 : total, Math.max(1, Math.ceil(total * firstShare)));
  let second = Math.min(caps[b], total - first);
  first = Math.min(caps[a], total - second);
  const lanes: C[] = [];
  for (let i = 0; i < Math.max(first, second); i++) {
    if (i < first) lanes.push(a);
    if (i < second) lanes.push(b);
  }
  return lanes;
}

/** 限流信号：明确的 429、限流、keyLimit 或额度类错误。 */
export function isKnowledgeRateLimited(error: unknown) {
  const text = error instanceof Error ? `${error.message} ${String((error as any).code ?? "")}` : String(error ?? "");
  return /\b429\b|rate.?limit|too many requests|keyLimit|key_limit|quota|资源耗尽|限流|RESOURCE_EXHAUSTED/i.test(text);
}

/**
 * 自适应闸门：允许在途数 ≤ limit；遇限流信号 limit 减半（至少 1），每次成功 +1 回升至上限。
 * 只控制下一次何时发出，不取消已在途请求。
 */
export class KnowledgeRateGate {
  private inFlight = 0;
  private waiters: (() => void)[] = [];
  limit: number;
  rateLimited = 0;
  constructor(readonly max: number) { this.limit = Math.max(1, max); }
  async acquire() {
    while (this.inFlight >= this.limit) await new Promise<void>(resolve => this.waiters.push(resolve));
    this.inFlight++;
  }
  release(outcome: "ok" | "rate_limited" | "error") {
    this.inFlight = Math.max(0, this.inFlight - 1);
    if (outcome === "rate_limited") { this.rateLimited++; this.limit = Math.max(1, Math.floor(this.limit / 2)); }
    else if (outcome === "ok" && this.limit < this.max) this.limit++;
    const wake = this.waiters.splice(0);
    for (const resolve of wake) resolve();
  }
}

/**
 * 通用错峰池：按 lanes 给出的通道路数并发取任务；同通道第 k 路首发前等待 k×staggerMs；
 * 每通道一个自适应闸门。worker 抛出的错误原样收集，池不重试（重试与回执由各阶段原逻辑负责）。
 */
export async function runKnowledgeStaggeredPool<T, R, C extends string>(items: readonly T[], options: {
  lanes: readonly C[];
  worker: (item: T, index: number, channel: C) => Promise<R>;
  staggerMs?: number;
  gates?: Partial<Record<C, KnowledgeRateGate>>;
  /** 返回 false 时停止领取新任务（已在途的照常收口）。 */
  active?: () => boolean;
  sleep?: (ms: number) => Promise<void>;
}) {
  const results: R[] = new Array(items.length);
  const errors: { index: number; error: unknown }[] = [];
  const sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const stagger = options.staggerMs ?? KNOWLEDGE_STAGGER_MS;
  const seen = new Map<C, number>();
  let next = 0;
  await Promise.all(options.lanes.map(async channel => {
    const ordinal = seen.get(channel) ?? 0;
    seen.set(channel, ordinal + 1);
    if (ordinal && stagger) await sleep(ordinal * stagger);
    const gate = options.gates?.[channel];
    while ((options.active?.() ?? true) && next < items.length) {
      const index = next++;
      if (gate) await gate.acquire();
      let outcome: "ok" | "rate_limited" | "error" = "ok";
      try { results[index] = await options.worker(items[index]!, index, channel); }
      catch (error) { outcome = isKnowledgeRateLimited(error) ? "rate_limited" : "error"; errors.push({ index, error }); }
      finally { gate?.release(outcome); }
    }
  }));
  return { results, errors };
}

/**
 * 单通道整轮池：n 个任务按动态并发一轮发完；第一个错误在全部在途收口后抛出（与原 Promise.all 语义一致：不吞错）。
 */
export async function knowledgePooled(count: number, worker: (index: number) => Promise<void>, max = KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter) {
  const concurrency = knowledgeStageConcurrency(count, { max });
  const { errors } = await runKnowledgeStaggeredPool(Array.from({ length: count }, (_, i) => i), {
    lanes: Array.from({ length: concurrency }, () => "pool" as const), staggerMs: 0, worker: async i => { await worker(i); },
  });
  if (errors.length) throw errors.sort((a, b) => a.index - b.index)[0]!.error;
}
