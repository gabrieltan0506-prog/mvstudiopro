import { KNOWLEDGE_MODEL_CHANNEL_MAX, KNOWLEDGE_STAGGER_MS, KnowledgeRateGate, isKnowledgeRateLimited, knowledgeChannelLanes } from "./knowledgeConcurrency";

export type KnowledgePublicationChannel = "openrouter" | "evolink";
export type KnowledgePublicationParallel = {
  channels: Record<string, KnowledgePublicationChannel>;
  completed: number[];
  /** 审校链模型序；新稿写 glm（GLM FlashX→DeepSeek），旧稿缺省沿用原 DeepSeek 优先，保证旧回执身份不变。 */
  family?: "glm" | "deepseek";
};

/**
 * 合并保存（1110 实测根因：每次「固定通道」与「收妥回执」都单独整库保存云稿，约 10 秒一次且串行，
 * 34 批光发车就排了 6 分钟、收尾又在保存队列里排队）。
 *
 * 同一时刻排队的改动在下一次保存里一起落盘：保存进行中到达的改动并入紧随其后的那一次。
 * 语义保持：每个改动只有在包含它的保存成功后才 resolve（通道固定先落盘、后发请求）；
 * 单个改动抛错只拒绝它自己，不污染其他工位；保存失败时同批改动全部拒绝。
 */
export function knowledgeCoalescedUpdater(options: { save: () => Promise<void>; guard?: () => void }) {
  type Item = { change: () => void; resolve: () => void; reject: (error: unknown) => void };
  let queue: Item[] = [];
  let tail: Promise<void> = Promise.resolve();
  let scheduled = false;
  const flush = async () => {
    scheduled = false;
    const items = queue;
    queue = [];
    try { options.guard?.(); }
    catch (error) { for (const item of items) item.reject(error); return; }
    const applied: Item[] = [];
    for (const item of items) {
      try { item.change(); applied.push(item); }
      catch (error) { item.reject(error); }
    }
    if (!applied.length) return;
    try { await options.save(); for (const item of applied) item.resolve(); }
    catch (error) { for (const item of applied) item.reject(error); }
  };
  return (change: () => void) => new Promise<void>((resolve, reject) => {
    queue.push({ change, resolve, reject });
    if (scheduled) return;
    scheduled = true;
    tail = tail.then(flush, flush);
  });
}

/** 旧稿的连续完成前缀与新稿的乱序完成集合共同决定哪些批次仍需处理。 */
export function completedKnowledgeBatches(
  value: { completedBatches: number; parallel?: KnowledgePublicationParallel },
  count: number,
) {
  return new Set([
    ...Array.from({ length: Math.min(count, value.completedBatches) }, (_, i) => i),
    ...(value.parallel?.completed || []).filter(i => i < count),
  ]);
}

export function knowledgeCompletedPrefix(completed: ReadonlySet<number>, count: number) {
  let next = 0;
  while (next < count && completed.has(next)) next++;
  return next;
}

/**
 * 动态工位（按待办批次数一轮发完，每通道≤上限，OpenRouter 份额略大，同通道错峰首发）消费同一待办队列；
 * 失败只停该工位，其他在途必须收妥回执；遇限流信号该通道闸门减半。已固定通道的批次仍只由原通道处理。
 */
export async function runKnowledgeParallelBatches<T>(options: {
  count: number;
  completed: ReadonlySet<number>;
  channels: Record<string, KnowledgePublicationChannel>;
  active: () => boolean;
  assign: (index: number, channel: KnowledgePublicationChannel) => Promise<void>;
  /** 等待输入就绪，不占用顾问通道；只读等待不改变事务身份。 */
  prepare?: (index: number) => Promise<void>;
  execute: (index: number, channel: KnowledgePublicationChannel) => Promise<T>;
  complete: (index: number, result: T) => Promise<void>;
  /** 测试或诊断时指定工位；默认按待办数动态计算。 */
  lanes?: readonly KnowledgePublicationChannel[];
  staggerMs?: number;
  sleep?: (ms: number) => Promise<void>;
}) {
  const pending = new Set(Array.from({ length: options.count }, (_, i) => i).filter(i => !options.completed.has(i)));
  const errors: { index: number; error: unknown }[] = [];
  const ready = new Set(options.prepare ? [] : pending);
  const preparing = new Map<number, Promise<void>>();
  if (options.prepare) for (const index of Array.from(pending)) {
    const promise = Promise.resolve().then(() => options.prepare!(index)).then(() => {
      ready.add(index);
    }, error => {
      pending.delete(index);
      errors.push({ index, error });
    });
    preparing.set(index, promise);
  }
  // 用户规则 2026-11-09：审校链 EvoLink 优先（份额略大、首发），OpenRouter 其后；两通道仍并发。
  const lanes: KnowledgePublicationChannel[] = [...(options.lanes ?? knowledgeChannelLanes(pending.size, KNOWLEDGE_MODEL_CHANNEL_MAX, ["evolink", "openrouter"] as const))];
  // 续跑时已固定通道的批次必须有对应工位。
  for (const channel of ["openrouter", "evolink"] as const)
    if (!lanes.includes(channel) && Array.from(pending).some(i => options.channels[String(i)] === channel)) lanes.push(channel);
  const gates = { openrouter: new KnowledgeRateGate(KNOWLEDGE_MODEL_CHANNEL_MAX.openrouter), evolink: new KnowledgeRateGate(KNOWLEDGE_MODEL_CHANNEL_MAX.evolink) };
  const sleep = options.sleep ?? (ms => new Promise<void>(r => setTimeout(r, ms)));
  const ordinals = { openrouter: 0, evolink: 0 };
  await Promise.all(lanes.map(async channel => {
    const ordinal = ordinals[channel]++;
    let staggered = false;
    while (options.active()) {
      const eligible = Array.from(pending).filter(i => !options.channels[String(i)] || options.channels[String(i)] === channel);
      if (!eligible.length) return;
      const index = eligible.find(i => ready.has(i));
      if (index === undefined) {
        await Promise.race(eligible.map(i => preparing.get(i)!));
        continue;
      }
      pending.delete(index);
      let outcome: "ok" | "rate_limited" | "error" = "ok";
      try {
        await options.assign(index, channel);
        if (!options.active()) return;
        const wait = staggered ? 0 : ordinal * (options.staggerMs ?? KNOWLEDGE_STAGGER_MS);
        if (wait) await sleep(wait);
        staggered = true;
        await gates[channel].acquire();
        let result: T;
        try { result = await options.execute(index, channel); }
        catch (error) { outcome = isKnowledgeRateLimited(error) ? "rate_limited" : "error"; throw error; }
        finally { gates[channel].release(outcome); }
        // 请求开始后即使页面离开也收妥回执；停止只影响尚未发出的请求。
        await options.complete(index, result);
      } catch (error) {
        errors.push({ index, error });
        return;
      }
    }
  }));
  return errors.sort((a, b) => a.index - b.index);
}
