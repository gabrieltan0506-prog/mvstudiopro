export type NativeReadPoolRoute = "vertex" | "evolink";

/** 同一worker进程共享两路容量；首批指定通道，续片在实际空位出现时才分配。 */
export class NativeReadRouteScheduler {
  private readonly active = { vertex: 0, evolink: 0 };
  private readonly queue: Array<{
    preferred?: NativeReadPoolRoute;
    grant: (route: NativeReadPoolRoute) => void;
    abort: () => void;
  }> = [];
  constructor(private readonly capacity = { vertex: 5, evolink: 6 }) {}

  acquire(preferred?: NativeReadPoolRoute, signal?: AbortSignal): Promise<{ route: NativeReadPoolRoute; release: () => void }> {
    signal?.throwIfAborted();
    return new Promise((resolve, reject) => {
      const waiter = {
        preferred,
        abort: () => {
          const index = this.queue.indexOf(waiter);
          if (index >= 0) this.queue.splice(index, 1);
          reject(signal?.reason ?? new Error("学习请求已取消"));
        },
        grant: (route: NativeReadPoolRoute) => {
          signal?.removeEventListener("abort", waiter.abort);
          this.active[route] += 1;
          let released = false;
          resolve({ route, release: () => {
            if (released) return;
            released = true;
            this.active[route] -= 1;
            this.drain();
          } });
        },
      };
      signal?.addEventListener("abort", waiter.abort, { once: true });
      this.queue.push(waiter);
      this.drain();
    });
  }

  private drain(): void {
    for (let index = 0; index < this.queue.length;) {
      const waiter = this.queue[index]!;
      const routes: NativeReadPoolRoute[] = waiter.preferred ? [waiter.preferred] : ["vertex", "evolink"];
      const route = routes.find(name => this.active[name] < this.capacity[name]);
      if (!route) { index += 1; continue; }
      this.queue.splice(index, 1);
      waiter.grant(route);
    }
  }

  async run<T>(preferred: NativeReadPoolRoute | undefined, operation: (route: NativeReadPoolRoute) => Promise<T>, signal?: AbortSignal): Promise<T> {
    const lease = await this.acquire(preferred, signal);
    try { signal?.throwIfAborted(); return await operation(lease.route); }
    finally { lease.release(); }
  }
}

export const nativeReadRouteScheduler = new NativeReadRouteScheduler();
