import { afterEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ available: true, pending: true, scans: 0 }));
vi.mock("../db", () => ({
  getDb: async () => {
    if (!state.available) throw Error("临时不可用");
    return {
      update: () => ({ set: () => ({ where: () => ({ returning: async () => { state.scans++; return []; } }) }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => state.pending ? [{ id: "test-job" }] : [] }) }) }),
    };
  },
}));
import { scheduleKnowledgeCancelRecovery } from "./repository";
afterEach(() => { vi.clearAllTimers(); vi.useRealTimers(); });

it("临时断库、迟到心跳后继续收尾，空闲后停止检查", async () => {
  vi.useFakeTimers();
  state.available = false;
  scheduleKnowledgeCancelRecovery();
  scheduleKnowledgeCancelRecovery();
  expect(vi.getTimerCount()).toBe(1);
  await vi.advanceTimersByTimeAsync(121_000);
  expect(vi.getTimerCount()).toBe(1);
  state.available = true;
  await vi.advanceTimersByTimeAsync(121_000);
  expect(state.scans).toBe(1);
  expect(vi.getTimerCount()).toBe(1);
  state.pending = false;
  await vi.advanceTimersByTimeAsync(121_000);
  expect(state.scans).toBe(2);
  expect(vi.getTimerCount()).toBe(0);
});
