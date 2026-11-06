export type KnowledgePublicationChannel = "openrouter" | "evolink";
export type KnowledgePublicationParallel = {
  channels: Record<string, KnowledgePublicationChannel>;
  completed: number[];
};

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

/** 两条通道消费同一待办队列；单路失败只停该路，已发出的另一批必须收妥回执。 */
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
  await Promise.all((["openrouter", "evolink"] as const).map(async channel => {
    while (options.active()) {
      const eligible = Array.from(pending).filter(i => !options.channels[String(i)] || options.channels[String(i)] === channel);
      if (!eligible.length) return;
      const index = eligible.find(i => ready.has(i));
      if (index === undefined) {
        await Promise.race(eligible.map(i => preparing.get(i)!));
        continue;
      }
      pending.delete(index);
      try {
        await options.assign(index, channel);
        if (!options.active()) return;
        const result = await options.execute(index, channel);
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
