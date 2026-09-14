import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { createPreviewPruneTick, scheduledDay } from "./vercelPreviewScheduler";

const AT = Date.parse("2026-09-13T02:40:00Z");
const result = { candidates: 1, attempted: 1, deleted: 1, skipped: 0, remaining: 0, dryRun: false, receipt: "test-receipt" };
function setup(run = vi.fn().mockResolvedValue(result)) {
  const root = mkdtempSync(join(tmpdir(), "vercel-scheduler-test-"));
  let time = AT;
  const options = { root, now: () => time, run, log: vi.fn() };
  return { root, run, options, job: createPreviewPruneTick(options), setTime: (n: number) => { time = n; },
    state: () => JSON.parse(readFileSync(join(root, "daily-2026-09-13.json"), "utf8")) };
}
describe("Fly每日预览清理", () => {
  it("北京时间10:40到点，日期不随服务器时区偏移", () => {
    expect(scheduledDay(AT - 1)).toBeNull();
    expect(scheduledDay(AT)).toBe("2026-09-13");
    expect(scheduledDay(Date.parse("2026-09-13T16:00:00Z"))).toBeNull();
  });
  it("到点执行真删并持久化非空回执，重启不重跑当天", async () => {
    const f = setup(); await f.job.tick();
    expect(f.run).toHaveBeenCalledWith(expect.objectContaining({ apply: true, root: f.root }));
    expect(f.state()).toMatchObject({ status: "completed", result });
    await createPreviewPruneTick(f.options).tick(); expect(f.run).toHaveBeenCalledTimes(1);
    f.setTime(AT + 86_400_000); await f.job.tick(); expect(f.run).toHaveBeenCalledTimes(2);
  });
  it("当天未完成且服务晚启动会补跑", async () => {
    const f = setup(); f.setTime(AT + 3_600_000); await f.job.tick(); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it("在途部署且未发DELETE则15分钟后重新检查", async () => {
    const f = setup(vi.fn().mockRejectedValueOnce({ code: "PRUNE_DEFERRED", attemptedDelete: false, receipt: "test-deferred" }).mockResolvedValue(result));
    await f.job.tick(); expect(f.state().status).toBe("deferred");
    await f.job.tick(); expect(f.run).toHaveBeenCalledTimes(1);
    f.setTime(AT + 15 * 60_000); await f.job.tick(); expect(f.state().status).toBe("completed");
  });
  it("已发DELETE后的延期或失败不在当天重放", async () => {
    const f = setup(vi.fn().mockRejectedValue({ code: "PRUNE_DEFERRED", attemptedDelete: true }));
    await f.job.tick(); f.setTime(AT + 3_600_000); await f.job.tick();
    expect(f.state().status).toBe("failed"); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it("重启发现未决批次不重放，状态损坏不偷偷覆盖", async () => {
    const f = setup(); const path = join(f.root, "daily-2026-09-13.json");
    writeFileSync(path, JSON.stringify({ day: "2026-09-13", status: "running" }));
    await f.job.tick(); expect(f.run).not.toHaveBeenCalled();
    writeFileSync(path, "broken"); await expect(f.job.tick()).rejects.toThrow();
    expect(f.run).not.toHaveBeenCalled();
  });
  it("慢请求期间tick不重复；停止会中断信号且不再启动", async () => {
    let resolve!: (value: typeof result) => void;
    const f = setup(vi.fn(() => new Promise(r => { resolve = r; })));
    const pending = f.job.tick(); await f.job.tick(); expect(f.run).toHaveBeenCalledTimes(1);
    const signal = f.run.mock.calls[0][0].signal;
    f.job.stop(); expect(signal.aborted).toBe(true);
    resolve(result); await pending; await f.job.tick(); expect(f.run).toHaveBeenCalledTimes(1);
  });
  it("达到删除预算保留剩余数，不能报完整清理", async () => {
    const f = setup(vi.fn().mockResolvedValue({ ...result, remaining: 2 }));
    await f.job.tick(); expect(f.state()).toMatchObject({ status: "partial", result: { remaining: 2 } });
  });
});
