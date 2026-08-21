/**
 * enhanceCanvasPrompt 路由回归:replay 恢复在余额检查之前——已付费结果的恢复
 * 不受当前余额影响(0 余额也能取回);不足额新任务先认领 failed 再拒绝。
 */
import { describe, expect, it, vi } from "vitest";

const reservePromptEnhanceOperation = vi.fn();
const claimPromptEnhanceFailed = vi.fn(
  async (..._a: unknown[]) => "failed" as "failed" | "succeeded" | "missing",
);
const markPromptEnhanceSucceededWithRetry = vi.fn(async (..._a: unknown[]) => true);
const withPromptEnhanceHeartbeat = vi.fn(async (_id: string, work: () => Promise<unknown>) => work());
vi.mock("./services/promptEnhanceOperation", () => ({
  reservePromptEnhanceOperation: (...a: unknown[]) => reservePromptEnhanceOperation(...a),
  claimPromptEnhanceFailed: (...a: unknown[]) => claimPromptEnhanceFailed(...a),
  markPromptEnhanceSucceededWithRetry: (...a: unknown[]) =>
    markPromptEnhanceSucceededWithRetry(...a),
  withPromptEnhanceHeartbeat: (...a: unknown[]) =>
    (withPromptEnhanceHeartbeat as unknown as (...x: unknown[]) => Promise<unknown>)(...a),
}));

const enhancePromptForEngine = vi.fn();
vi.mock("./services/promptEnhance", () => ({
  PROMPT_ENHANCE_CREDITS: 3,
  enhancePromptForEngine: (...a: unknown[]) => enhancePromptForEngine(...a),
}));

const getCredits = vi.fn(async (..._a: unknown[]) => ({ totalAvailable: 0 }));
const deductCreditsAmount = vi.fn();
vi.mock("./credits", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getCredits: (...a: unknown[]) => getCredits(...a),
  deductCreditsAmount: (...a: unknown[]) => deductCreditsAmount(...a),
}));

import { appRouter } from "./routers";

const UUID = "6f9619ff-8b86-4d01-b42d-00cf4fc964ff";
const caller = () =>
  appRouter.createCaller({ user: { id: 7, role: "user" } } as never);

describe("enhanceCanvasPrompt · replay 与余额顺序", () => {
  it("jobs 已 succeeded + 当前余额 0:仍返回保存结果,零扣费零模型调用", async () => {
    reservePromptEnhanceOperation.mockResolvedValueOnce({
      kind: "replay",
      jobId: "prompt_enhance_x",
      result: {
        action: "prompt_enhance_done",
        requestFingerprint: "fp",
        enhancedPrompt: "已保存的增强结果",
        issues: [],
        gateway: "bailian",
        engine: "seedance-2.5",
        creditsBilled: 3,
      },
    });
    const r = await caller().mvAnalysis.enhanceCanvasPrompt({
      prompt: "雨夜巷战",
      engine: "seedance-2.5",
      billingRequestId: UUID,
    });
    expect(r.enhancedPrompt).toBe("已保存的增强结果");
    expect(deductCreditsAmount).not.toHaveBeenCalled();
    expect(enhancePromptForEngine).not.toHaveBeenCalled();
    expect(getCredits).not.toHaveBeenCalled(); // 余额检查在 replay 之后
  });

  it("execute 新任务且余额不足:先认领 failed 再回 BAD_REQUEST,不扣费不调模型", async () => {
    reservePromptEnhanceOperation.mockResolvedValueOnce({
      kind: "execute",
      jobId: "prompt_enhance_y",
      requestFingerprint: "fp",
    });
    await expect(
      caller().mvAnalysis.enhanceCanvasPrompt({
        prompt: "雨夜巷战",
        engine: "seedance-2.5",
        billingRequestId: UUID,
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(claimPromptEnhanceFailed).toHaveBeenCalledWith("prompt_enhance_y", "Credits 不足");
    expect(deductCreditsAmount).not.toHaveBeenCalled();
    expect(enhancePromptForEngine).not.toHaveBeenCalled();
  });

  it("非 UUID 请求编号被 zod 拒绝", async () => {
    await expect(
      caller().mvAnalysis.enhanceCanvasPrompt({
        prompt: "雨夜巷战",
        engine: "seedance-2.5",
        billingRequestId: "short-id-123",
      }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(reservePromptEnhanceOperation).not.toHaveBeenCalledTimes(3);
  });
});
