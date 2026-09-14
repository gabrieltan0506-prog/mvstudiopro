import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, afterEach, it, expect, vi } from "vitest";
const h = vi.hoisted(() => ({ submit: vi.fn(), poll: vi.fn(), refund: vi.fn(), pause: vi.fn(), register: vi.fn() }));
vi.mock("./homePhotoVideo.js", () => ({ isHomePhotoVideoConfigured: () => true, submitHomePhotoVideo: h.submit, pollHomePhotoVideo: h.poll }));
vi.mock("./paidJobLedger.js", () => ({ heartbeatActiveJob: vi.fn(async () => {}), pauseActiveJob: h.pause, registerActiveJob: h.register, refundCreditsOnFailure: h.refund, unregisterActiveJob: vi.fn(), hasRefundMarker: vi.fn(), refundMarkerFor: vi.fn(), canonicalRefundKey: vi.fn(), markSettlementPending: vi.fn() }));
vi.mock("../credits.js", () => ({ getUserPlan: async () => "pro", refundCredits: vi.fn() }));
vi.mock("../routers/creations.js", () => ({ recordCreation: vi.fn() }));
vi.setConfig({ testTimeout: 30000 });
let dir: string;
beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "photo-recovery-"));
  vi.stubEnv("HOME_PHOTO_ANIMATE_TASK_DIR", dir);
  h.submit.mockResolvedValue({ evolinkTaskId: "same-upstream", model: "seedance-2.0-image-to-video" });
  h.poll.mockResolvedValue({ state: "running" });
  h.pause.mockResolvedValue(undefined);
  h.register.mockResolvedValue(undefined);
  h.refund.mockResolvedValue({ status: "refunded", refunded: true });
});
afterEach(async () => { vi.unstubAllEnvs(); await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }); });
async function seed(patch: Record<string, unknown> = {}) {
  const taskId = "hpa_test_recovery";
  const now = new Date().toISOString();
  await fs.writeFile(path.join(dir, `${taskId}.json`), JSON.stringify({ taskId, userId: 7, status: "queued", creditsCharged: 79, modelChoice: "seedance-2.0", imageUrl: "https://example.com/a.png", prompt: "微笑", duration: 10, resolution: "720p", createdAt: now, updatedAt: now, ledgerReady: true, ...patch }));
  return taskId;
}
it("同一动画任务只发一次，句柄落盘后只轮询", async () => {
  const id = await seed(); const m = await import("./homePhotoAnimateTask");
  expect((await m.getHomePhotoAnimateTask(id, 7))?.evolinkTaskId).toBe("same-upstream");
  await m.getHomePhotoAnimateTask(id, 7);
  expect(h.submit).toHaveBeenCalledTimes(1); expect(h.poll).toHaveBeenCalledTimes(1);
  expect(h.refund).not.toHaveBeenCalled();
});
it("已写提交标记、无回执的重启记录转对账，不重投不退款", async () => {
  const id = await seed({ submissionStartedAt: new Date().toISOString() }); const m = await import("./homePhotoAnimateTask");
  expect((await m.getHomePhotoAnimateTask(id, 7))?.status).toBe("reconcile_manual");
  expect(h.submit).not.toHaveBeenCalled(); expect(h.refund).not.toHaveBeenCalled();
});
it("明确拒绝退款、unknown不退款", async () => {
  const id = await seed(); const m = await import("./homePhotoAnimateTask");
  h.submit.mockRejectedValueOnce(Object.assign(new Error("rejected"), { kind: "rejected" }));
  expect((await m.getHomePhotoAnimateTask(id, 7))?.status).toBe("failed"); expect(h.refund).toHaveBeenCalledTimes(1);
  await seed(); h.refund.mockClear(); h.submit.mockRejectedValueOnce(Object.assign(new Error("unknown"), { kind: "unknown" }));
  expect((await m.getHomePhotoAnimateTask(id, 7))?.status).toBe("reconcile_manual"); expect(h.refund).not.toHaveBeenCalled();
});
it("账本登记前旧进程退出的任务不永远排队，确认未提交后退款", async () => {
  const id = await seed({ ledgerReady: false, createdAt: "2000-01-01T00:00:00Z" }); const m = await import("./homePhotoAnimateTask");
  expect((await m.getHomePhotoAnimateTask(id, 7))?.status).toBe("failed");
  expect(h.submit).not.toHaveBeenCalled(); expect(h.refund).toHaveBeenCalledTimes(1);
});
it("并发创建同一稳定任务编号只登记一次", async () => {
  const m = await import("./homePhotoAnimateTask");
  const input = { taskId: "hpa_atomic_test", userId: 7, creditsCharged: 79, modelChoice: "seedance-2.0" as const, imageUrl: "https://example.com/a.png", prompt: "微笑", duration: 10, resolution: "720p" };
  const tasks = await Promise.all([m.createHomePhotoAnimateTask(input), m.createHomePhotoAnimateTask(input)]);
  expect(tasks[0].taskId).toBe(tasks[1].taskId); expect(h.register).toHaveBeenCalledTimes(1);
  for (let i = 0; i < 30; i++) { if (JSON.parse(await fs.readFile(path.join(dir, "hpa_atomic_test.json"), "utf8")).evolinkTaskId) break; await new Promise(r => setTimeout(r, 20)); }
  expect(h.submit).toHaveBeenCalledTimes(1);
});
