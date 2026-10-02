/** 单进程顺序抢占，避免三路同时读到同一个排队任务；处理最多三路。 */
export async function drainBgmQueue<T>(claim: () => Promise<T | null>, process: (job: T) => Promise<unknown>) {
  let claimTail: Promise<unknown> = Promise.resolve();
  const next = () => {
    const result = claimTail.then(claim);
    claimTail = result.then(() => undefined, () => undefined);
    return result;
  };
  await Promise.all(Array.from({ length: 3 }, async () => {
    for (;;) {
      const job = await next();
      if (!job) return;
      await process(job);
    }
  }));
}
