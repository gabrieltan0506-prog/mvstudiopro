/**
 * Suno 直连桥的路由把关：普通用户绕过 UI 直接调 tRPC 也碰不到桥。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const repo = vi.hoisted(() => ({ createJob: vi.fn(), getJobByIdStrict: vi.fn() }));
vi.mock("./jobs/repository", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createJob: repo.createJob,
  getJobByIdStrict: repo.getJobByIdStrict,
}));
vi.mock("./jobs/repository.js", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createJob: repo.createJob,
  getJobByIdStrict: repo.getJobByIdStrict,
}));

import { appRouter } from "./routers";
import { buildScoringRoomBrief } from "./services/manhuaScoringRoom";

const draftInput = { laneZh: "测", durationSec: 30, moods: ["蓄力" as const], moodArcZh: "雨夜守护", titleZh: "配乐" };
const caller = (role: "user" | "admin") => appRouter.createCaller({ user: { id: 7, role } } as never);

describe("配乐直连桥 · 路由把关", () => {
  beforeEach(() => {
    repo.createJob.mockReset();
    repo.getJobByIdStrict.mockReset();
    process.env.SUNO_BRIDGE_URL = "http://mvstudiopro-suno-bridge.internal:3000";
  });

  it("普通用户起草时传桥模型 → 回落网关 v5.5；admin 传 → 真带桥模型", async () => {
    const user = await caller("user").mvAnalysis.draftManhuaBgmBrief({ ...draftInput, model: "suno-bridge-v6" });
    expect(user.brief.model).toBe("suno-v5.5-beta");
    const admin = await caller("admin").mvAnalysis.draftManhuaBgmBrief({ ...draftInput, model: "suno-bridge-v6" });
    expect(admin.brief.model).toBe("suno-bridge-v6");
  });

  it("普通用户直接 queue 桥模型 → FORBIDDEN，不建任务；未配桥 → PRECONDITION_FAILED", async () => {
    const brief = buildScoringRoomBrief({ ...draftInput, model: "suno-bridge-v6-mini" });
    const billingRequestId = "11111111-2222-4333-8444-555555555555";
    await expect(caller("user").mvAnalysis.queueManhuaBgm({ billingRequestId, brief })).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(repo.createJob).not.toHaveBeenCalled();
    delete process.env.SUNO_BRIDGE_URL;
    await expect(caller("admin").mvAnalysis.queueManhuaBgm({ billingRequestId, brief })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(repo.createJob).not.toHaveBeenCalled();
  });

  it("admin queue 桥模型 → 建任务且 provider 标 suno-bridge:*", async () => {
    const brief = buildScoringRoomBrief({ ...draftInput, model: "suno-bridge-v6-wild" });
    const billingRequestId = "11111111-2222-4333-8444-555555555556";
    repo.createJob.mockResolvedValue(undefined);
    repo.getJobByIdStrict.mockResolvedValue({
      id: `bgm_${billingRequestId.replace(/-/g, "")}`, userId: "7", type: "audio", status: "queued", provider: "suno-bridge:suno-bridge-v6-wild",
      input: { action: "manhua_bgm_v55", params: { billingRequestId, brief } }, output: null, error: null, createdAt: new Date(), updatedAt: new Date(),
    });
    await caller("admin").mvAnalysis.queueManhuaBgm({ billingRequestId, brief });
    expect(repo.createJob).toHaveBeenCalledTimes(1);
    expect(repo.createJob.mock.calls[0]![0]).toMatchObject({ provider: "suno-bridge:suno-bridge-v6-wild", userId: "7" });
  });
});
