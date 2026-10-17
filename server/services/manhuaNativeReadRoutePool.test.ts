import { describe, expect, it, vi } from "vitest";
import { NativeReadRoutePool } from "./manhuaNativeReadRoutePool.js";

describe("学习通道共享容量与取消", () => {
  it("排队取消不发请求，失败释放容量供下一批使用", async () => {
    const pool = new NativeReadRoutePool(1);
    let release!: () => void;
    const first = pool.run(async () => { await new Promise<void>(r => { release = r; }); throw new Error("供应商失败"); });
    const firstFailure = first.catch(e => e);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    const controller = new AbortController();
    const cancelledCall = vi.fn(async () => "不应调用");
    const cancelled = pool.run(cancelledCall, controller.signal).catch(e => e);
    const nextCall = vi.fn(async () => "下一批成功");
    const next = pool.run(nextCall);
    controller.abort(new Error("用户取消"));
    expect((await cancelled).message).toBe("用户取消");
    expect(cancelledCall).not.toHaveBeenCalled();
    expect(nextCall).not.toHaveBeenCalled();
    release();
    expect((await firstFailure).message).toBe("供应商失败");
    expect(await next).toBe("下一批成功");
  });

  it("两个批次共用池，活动请求合计不超过六路", async () => {
    const pool = new NativeReadRoutePool(6);
    let active = 0, peak = 0;
    let release!: () => void;
    const gate = new Promise<void>(r => { release = r; });
    const call = () => pool.run(async () => { active += 1; peak = Math.max(peak, active); await gate; active -= 1; });
    const batch1 = Promise.all(Array.from({ length: 6 }, call));
    const batch2 = Promise.all(Array.from({ length: 6 }, call));
    await vi.waitFor(() => expect(active).toBe(6));
    release();
    await Promise.all([batch1, batch2]);
    expect(peak).toBe(6);
    expect(active).toBe(0);
  });
});
