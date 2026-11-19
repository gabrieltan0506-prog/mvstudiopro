import { afterEach, beforeEach, expect, it, vi } from "vitest";
// 整链硬上限（Promise.race）不会中止已发出的供应商请求：已提交时超时必须是「结果未知」（转对账、不可重买），
// 提交之前超时仍是确定失败。
const providers = vi.hoisted(() => ({ openai: vi.fn(), evo: vi.fn(), wave: vi.fn(), router: vi.fn() }));
vi.mock("./openaiGptImage2.js", () => ({ isOpenAiGptImage2Configured: () => true, postOpenAiGptImage2AndUpload: providers.openai }));
vi.mock("./evolinkGptImage2.js", () => ({ isEvolinkGptImage2Configured: () => true, isEvolinkModerationFailure: () => false, postEvolinkGptImage2AndUpload: providers.evo }));
vi.mock("./wavespeedGptImage2.js", () => ({ isWavespeedGptImage2Configured: () => true, postWavespeedGptImage2AndUpload: providers.wave }));
vi.mock("./openrouterGptImage2.js", () => ({ isOpenRouterGptImage2Configured: () => true, postOpenRouterGptImage2AndUpload: providers.router }));
import { generatePlatformCompositeSheetImage } from "./proxyImageService";
import { knowledgeImageMayRetry } from "../../shared/knowledgeImageRetry";
const base = { kind: "single_page_knowledge_card" as const, userId: 7, title: "光合作用", scriptContext: "# 光合作用\n植物通过叶片利用光能。", notePageIndex: 1, notePageTotal: 1, knowledgeCardReferencePageUrls: [] as string[] };
beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  vi.stubEnv("PLATFORM_COMPOSITE_SHEET_JOB_TIMEOUT_MS", "60000");
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("禁止测试联网"); }));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
it("供应商请求已发出、整链超时：抛结果未知（kind=unknown），只发出一次请求", async () => {
  providers.openai.mockImplementation(async (_p: string, _d: string, o: { beforeImageSubmit?: () => Promise<void> }) => { await o.beforeImageSubmit?.(); return new Promise(() => {}); });
  const run = generatePlatformCompositeSheetImage({ ...base, beforeImageSubmit: async () => {} });
  const settled = run.then(() => null, (e: unknown) => e);
  await vi.waitFor(() => expect(providers.openai).toHaveBeenCalledTimes(1));
  await vi.advanceTimersByTimeAsync(60_000);
  const error = await settled as { kind?: string; message?: string };
  expect(error?.kind).toBe("unknown");
  expect(error.message).not.toMatch(/GPT|OpenAI|EvoLink|Sunburst/i);
  // 结果未知的页在路由层记为 pending：不可重买（零第二次出站）
  expect(knowledgeImageMayRetry({ status: "failed", input: { action: "platform_composite_sheet_progress", params: {} }, output: { knowledgeImageRetry: { version: 1, reason: "pending" } } })).toBe(false);
  expect(providers.openai).toHaveBeenCalledTimes(1);
  expect(providers.evo).not.toHaveBeenCalled();
});
it("提交闸门之前超时：仍是确定失败（不带 unknown），零出站", async () => {
  const run = generatePlatformCompositeSheetImage({ ...base, beforeImageSubmit: () => new Promise<void>(() => {}) });
  const settled = run.then(() => null, (e: unknown) => e);
  await vi.advanceTimersByTimeAsync(60_000);
  const error = await settled as { kind?: string; message?: string };
  expect(error).toBeInstanceOf(Error);
  expect(error.kind).toBeUndefined();
  expect(error.message).toContain("超时");
  for (const p of Object.values(providers)) expect(p).not.toHaveBeenCalled();
});
