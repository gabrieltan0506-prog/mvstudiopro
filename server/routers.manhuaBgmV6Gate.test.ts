/**
 * Suno v6（TTAPI）的路由把关：全员可用，但未配 TTAPI_KEY 时起草回落 v5.5、queue 直接拦。
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

describe("配乐 v6（TTAPI） · 路由把关", () => {
  beforeEach(() => {
    repo.createJob.mockReset();
    repo.getJobByIdStrict.mockReset();
    process.env.TTAPI_KEY = "test-key";
  });

  it.each([
    [{ missingVariants: 1 }, 1],
    [{ terminalOutput: { missingVariants: 2 } }, 2],
    [{}, 0],
    [{ missingVariants: -1 }, 0],
    [{ missingVariants: 1.5 }, 0],
    [{ missingVariants: "2" }, 0],
  ])("查询配乐保留缺失版本数，兼容旧记录及脏值 %j", async (output, expected) => {
    repo.getJobByIdStrict.mockResolvedValue({
      id: "bgm-test", userId: "7", type: "audio", status: "succeeded",
      input: { action: "manhua_bgm_v55", params: {} }, output,
      error: null, createdAt: new Date(), updatedAt: new Date(),
    });
    const result = await caller("admin").mvAnalysis.getManhuaBgmJob({ jobId: "bgm-test" });
    expect(result.missingVariants).toBe(expected);
    expect(repo.createJob).not.toHaveBeenCalled();
  });

  it("普通用户起草 v6 → 真带 v6；未配 TTAPI_KEY → 回落 v5.5", async () => {
    const user = await caller("user").mvAnalysis.draftManhuaBgmBrief({ ...draftInput, model: "suno-v6" });
    expect(user.brief.model).toBe("suno-v6");
    delete process.env.TTAPI_KEY;
    const fallback = await caller("user").mvAnalysis.draftManhuaBgmBrief({ ...draftInput, model: "suno-v6" });
    expect(fallback.brief.model).toBe("suno-v5.5-beta");
  });

  it("未配 TTAPI_KEY 直接 queue v6 → PRECONDITION_FAILED，不建任务", async () => {
    const brief = buildScoringRoomBrief({ ...draftInput, model: "suno-v6-mini" });
    const billingRequestId = "11111111-2222-4333-8444-555555555555";
    delete process.env.TTAPI_KEY;
    await expect(caller("user").mvAnalysis.queueManhuaBgm({ billingRequestId, brief })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect(repo.createJob).not.toHaveBeenCalled();
  });

  it("普通用户 queue v6 → 建任务且 provider 标 ttapi:*", async () => {
    const brief = buildScoringRoomBrief({ ...draftInput, model: "suno-v6-wild" });
    const billingRequestId = "11111111-2222-4333-8444-555555555556";
    repo.createJob.mockResolvedValue(undefined);
    repo.getJobByIdStrict.mockResolvedValue({
      id: `bgm_${billingRequestId.replace(/-/g, "")}`, userId: "7", type: "audio", status: "queued", provider: "ttapi:suno-v6-wild",
      input: { action: "manhua_bgm_v55", params: { billingRequestId, brief } }, output: null, error: null, createdAt: new Date(), updatedAt: new Date(),
    });
    await caller("user").mvAnalysis.queueManhuaBgm({ billingRequestId, brief });
    expect(repo.createJob).toHaveBeenCalledTimes(1);
    expect(repo.createJob.mock.calls[0]![0]).toMatchObject({ provider: "ttapi:suno-v6-wild", userId: "7" });
  });
});
