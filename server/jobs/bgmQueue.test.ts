import { expect, it, vi } from "vitest";
import { drainBgmQueue } from "./bgmQueue";
it("BGM最多三路，抢占串行且每个任务只处理一次", async () => {
  const queue = [1, 2, 3, 4, 5];
  let claiming = 0, active = 0, maximum = 0;
  const starts: number[] = [], releases: Array<() => void> = [];
  const pending = drainBgmQueue(async () => {
    expect(++claiming).toBe(1); await Promise.resolve(); claiming--;
    return queue.shift() ?? null;
  }, async job => {
    starts.push(job); maximum = Math.max(maximum, ++active);
    await new Promise<void>(resolve => releases.push(resolve)); active--;
  });
  await vi.waitFor(() => expect(starts).toEqual([1, 2, 3]));
  releases.splice(0).forEach(resolve => resolve());
  await vi.waitFor(() => expect(starts).toEqual([1, 2, 3, 4, 5]));
  releases.splice(0).forEach(resolve => resolve());
  await pending; expect(maximum).toBe(3);
});
