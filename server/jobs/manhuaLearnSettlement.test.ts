import { describe, expect, it, vi } from "vitest";
import { waitForManhuaLearnWorkerSettlement } from "./manhuaLearnSettlement.js";
describe("取消终态与执行器清理分离", () => {
  it("即使DB已终态也等待旧执行器真正释放", async () => {
    let active = true;
    const wait = vi.fn(async () => { active = false; });
    await waitForManhuaLearnWorkerSettlement({ isActive: () => active }, { now: () => 0, wait });
    expect(wait).toHaveBeenCalledTimes(1);
    expect(active).toBe(false);
  });
  it("旧执行器迟迟不退出时拒绝换模型，不把超时当停止", async () => {
    let now = 0;
    await expect(waitForManhuaLearnWorkerSettlement({ isActive: () => true, timeoutMs: 500 },
      { now: () => now, wait: async ms => { now += ms; } })).rejects.toThrow("未调用模型");
  });
  it("等待中再次取消立即停止", async () => {
    const controller = new AbortController();
    await expect(waitForManhuaLearnWorkerSettlement({ isActive: () => true, signal: controller.signal },
      { now: () => 0, wait: async () => { controller.abort(new Error("取消等待")); } })).rejects.toThrow("取消等待");
  });
});
