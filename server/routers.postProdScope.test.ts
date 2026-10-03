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
