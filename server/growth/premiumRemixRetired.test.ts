import { beforeEach, describe, expect, it, vi } from "vitest";

/** 爆款复刻分镜 / 出片退役：真实 appRouter；旧实现、扣费、模型与出片全部替身，验证「先拒绝、零扣费、零上游」。 */
const h = vi.hoisted(() => ({
  buildPremiumRemixPlan: vi.fn(),
  generatePremiumRemixAssets: vi.fn(),
  invokeLLM: vi.fn(),
  generateVideo: vi.fn(),
  generateGeminiImage: vi.fn(),
  deductCredits: vi.fn(),
  deductCreditsAmount: vi.fn(),
  createJob: vi.fn(),
}));
vi.mock("./premiumRemix", () => ({ buildPremiumRemixPlan: h.buildPremiumRemixPlan, generatePremiumRemixAssets: h.generatePremiumRemixAssets }));
vi.mock("../_core/llm", async (importOriginal) => ({ ...(await importOriginal<typeof import("../_core/llm")>()), invokeLLM: h.invokeLLM }));
vi.mock("../veo", async (importOriginal) => ({ ...(await importOriginal<typeof import("../veo")>()), generateVideo: h.generateVideo }));
vi.mock("../gemini-image", async (importOriginal) => ({ ...(await importOriginal<typeof import("../gemini-image")>()), generateGeminiImage: h.generateGeminiImage }));
vi.mock("../credits", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../credits")>()),
  deductCredits: h.deductCredits,
  deductCreditsAmount: h.deductCreditsAmount,
}));
vi.mock("../jobs/repository", async (importOriginal) => ({ ...(await importOriginal<typeof import("../jobs/repository")>()), createJob: h.createJob }));

import { appRouter } from "../routers";
import type { TrpcContext } from "../_core/context";
import { PREMIUM_REMIX_RETIRED_MESSAGE_ZH, premiumRemixRedirectTarget, LAPIAN_PATH } from "../../shared/premiumRemixRetired";

function ctx(user: { id: number; role: string } | null): TrpcContext {
  return {
    user: user ? ({ openId: `open-${user.id}`, name: "测试", email: null, ...user } as never) : null,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: { clearCookie: () => {} } as unknown as TrpcContext["res"],
    clientDisconnected: new AbortController().signal,
  };
}
const caller = (user: { id: number; role: string } | null) => appRouter.createCaller(ctx(user)) as any;

const legacyRemix = {
  overview: "旧方案", characterAnchors: [], storyboard: [{ shotId: "s1", veoPrompt: "x" }],
  loopTrack: { plan: {}, segments: [] }, interpolationTrack: { plan: {}, nodes: [] },
};

beforeEach(() => { for (const fn of Object.values(h)) fn.mockReset(); vi.spyOn(console, "warn").mockImplementation(() => {}); });

function expectNoSideEffects() {
  for (const [name, fn] of Object.entries(h)) expect(fn, name).not.toHaveBeenCalled();
}

describe("爆款复刻分镜 / 出片已并入拉片", () => {
  it.each([
    ["buildPremiumRemix", { context: "复刻这支", transcript: "台词" }],
    ["buildPremiumRemix", {}],
    ["buildPremiumRemix", undefined],
    ["generatePremiumRemixAssets", { remix: legacyRemix, mode: "loop" }],
    ["generatePremiumRemixAssets", { remix: legacyRemix, mode: "interpolation" }],
    ["generatePremiumRemixAssets", {}],
  ] as const)("%s：普通用户 / 管理员 / 监管一律 PRECONDITION_FAILED 业务提示，零扣费零上游", async (name, input) => {
    for (const role of ["user", "admin", "supervisor"]) {
      await expect(caller({ id: 7, role }).mvAnalysis[name](input)).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: PREMIUM_REMIX_RETIRED_MESSAGE_ZH });
    }
    expectNoSideEffects();
  });

  it("未登录仍先报 UNAUTHORIZED（登录校验不因退役放松）", async () => {
    for (const name of ["buildPremiumRemix", "generatePremiumRemixAssets"]) {
      await expect(caller(null).mvAnalysis[name]({})).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    }
    expectNoSideEffects();
  });

  it("提示文案不含模型名、通道名、供应商名", () => {
    expect(PREMIUM_REMIX_RETIRED_MESSAGE_ZH).not.toMatch(/gemini|veo|google|vertex|evolink|openai|kling|seedance|nano|gpt|claude|fly|vercel/i);
    expect(PREMIUM_REMIX_RETIRED_MESSAGE_ZH).toContain("拉片复刻爆款");
  });

  it("旧地址不论参数都跳到拉片页", () => {
    expect(premiumRemixRedirectTarget()).toBe(LAPIAN_PATH);
    expect(LAPIAN_PATH).toBe("/lapian");
  });
});
