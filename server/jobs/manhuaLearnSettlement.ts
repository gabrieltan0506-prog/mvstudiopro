/** DB 的取消终态可能先于 worker 退出；必须等本机执行器释放后才允许换模型。 */
export async function waitForManhuaLearnWorkerSettlement(input: {
  isActive: () => boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}, deps = { now: Date.now, wait: (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms)) }): Promise<void> {
  const deadline = deps.now() + (input.timeoutMs ?? 60_000);
  while (input.isActive()) {
    input.signal?.throwIfAborted();
    if (deps.now() >= deadline) throw new Error("原学习任务尚未结束清理，未调用模型；请稍后重新整形");
    await deps.wait(250);
  }
  input.signal?.throwIfAborted();
}
