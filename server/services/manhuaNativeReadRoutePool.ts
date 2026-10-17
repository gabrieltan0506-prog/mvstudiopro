/** 同一 worker 进程内所有学习任务共享容量；迁移请求也必须排队。 */
export class NativeReadRoutePool {
  private active = 0;
  private readonly queue: Array<{ grant: () => void; signal?: AbortSignal; abort: () => void }> = [];
  constructor(readonly capacity: number) {}

  private acquire(signal?: AbortSignal): Promise<() => void> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const waiter = {
        signal,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal?.reason ?? new Error("学习请求已取消"));
        },
        grant: () => {
          signal?.removeEventListener("abort", waiter.abort);
          this.active += 1;
          resolve(() => { this.active -= 1; this.drain(); });
        },
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.queue.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.capacity && this.queue.length) this.queue.shift()!.grant();
  }

  async run<T>(operation: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    const release = await this.acquire(signal);
    try { signal?.throwIfAborted(); return await operation(); }
    finally { release(); }
  }
}

export const nativeReadVertexPool = new NativeReadRoutePool(5);
export const nativeReadEvolinkPool = new NativeReadRoutePool(6);
