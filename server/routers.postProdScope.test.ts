import { beforeEach, describe, expect, it, vi } from "vitest";
import { postProdJobInputSchema } from "./jobs/postProdInput";

const { createJob, resolveSources } = vi.hoisted(() => ({
  createJob: vi.fn(),
  resolveSources: vi.fn(),
}));
vi.mock("./jobs/repository", async (original) => ({
  ...await original<Record<string, unknown>>(), createJob,
}));
vi.mock("./services/postProdMediaSource", async (original) => ({
  ...await original<Record<string, unknown>>(), resolvePostProdInputSources: resolveSources,
}));
import { appRouter } from "./routers";

const input = { action: "concat" as const, scopeKey: "project-7", params: {
  clips: ["gs://test/post-prod/7/first.mp4", "gs://test/post-prod/7/second.mp4"],
} };
const caller = (user: unknown = { id: 7, role: "user" }) => appRouter.createCaller({ user } as never);
beforeEach(() => {
  vi.clearAllMocks();
  resolveSources.mockImplementation(async ({ input }) => postProdJobInputSchema.parse(input));
});

describe("真实 queuePostProd 路由契约", () => {
  it("字幕特效随真实路由输入持久化，旧任务仍可省略", async () => {
    const base = { action: "burn_subtitle" as const, scopeKey: "project-7", params: { videoUri: "gs://test/post-prod/7/original.mp4", subtitleSrt: "1\n00:00:01,000 --> 00:00:03,000\n已确认对白\n" } };
    for (const effect of [undefined, "fade", "pop"] as const) {
      const request = { ...base, params: { ...base.params, ...(effect ? { effect } : {}) } };
      await caller().mvAnalysis.queuePostProd(request);
      const persisted = createJob.mock.calls.at(-1)![0];
      expect(persisted.input).toEqual(request);
      expect(postProdJobInputSchema.parse(JSON.parse(JSON.stringify(persisted.input)))).toEqual(request);
    }
    expect(createJob).toHaveBeenCalledTimes(3);
  });
  it("三种重点字幕经鉴权路由与JSON持久化保持字体和秒位", async () => {
    const highlights = ["impact", "arrange", "spiral"].map((effect, index) => ({ id: `cue-${index}`, effect, text: effect === "arrange" ? "目标｜待办" : "最终决定", startSec: index * 2, endSec: index * 2 + 1, positionPercent: 70, fontSize: 13 }));
    const request = { action: "burn_subtitle", scopeKey: "project-7", params: { videoUri: "gs://test/post-prod/7/original.mp4", subtitleSrt: "1\n00:00:00,000 --> 00:00:06,000\n已确认对白", highlights, styleOverride: { fontSize: 16, outline: 0.35, marginV: 50 } } };
    await caller().mvAnalysis.queuePostProd(request as never);
    expect(createJob.mock.calls[0][0].input).toEqual(request);
    expect(postProdJobInputSchema.parse(JSON.parse(JSON.stringify(createJob.mock.calls[0][0].input)))).toEqual(request);
  });
  it("项目拼接通过路由，来源核对后完整持久化为 worker 可复读格式", async () => {
    const result = await caller().mvAnalysis.queuePostProd(input);
    expect(result.status).toBe("queued");
    expect(resolveSources).toHaveBeenCalledWith({ userId: "7", input: postProdJobInputSchema.parse(input) });
    expect(createJob).toHaveBeenCalledTimes(1);
    const persisted = createJob.mock.calls[0][0];
    expect(persisted).toMatchObject({ userId: "7", type: "post_prod", input: { scopeKey: "project-7" } });
    expect(postProdJobInputSchema.parse(persisted.input)).toEqual(postProdJobInputSchema.parse(input));
  });
  it("未登录、来源拒绝、未知输入字段均不创建任务", async () => {
    await expect(caller(null).mvAnalysis.queuePostProd(input)).rejects.toThrow();
    await expect(caller().mvAnalysis.queuePostProd({ ...input, extra: true } as never)).rejects.toThrow();
    resolveSources.mockRejectedValueOnce(new Error("素材尚未登记"));
    await expect(caller().mvAnalysis.queuePostProd(input)).rejects.toThrow("素材尚未登记");
    expect(createJob).not.toHaveBeenCalled();
  });
});
