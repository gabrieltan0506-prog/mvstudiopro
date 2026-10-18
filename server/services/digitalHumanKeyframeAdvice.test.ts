import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ llm: vi.fn(), video: vi.fn(), trends: vi.fn() }));
vi.mock("../_core/llm.js", () => ({ invokeLLM: mocks.llm, extractJsonString: (s: string) => s, extractFirstChoicePlainText: (r: any) => r.choices[0].message.content }));
vi.mock("./manhuaAdvisorPrevisVideo", () => ({ resolveAdvisorPrevisVideo: mocks.video }));
vi.mock("../growth/trendStore.js", () => ({ readTrendStoreForPlatforms: mocks.trends }));
vi.mock("../db.js", () => ({ getDb: async () => null }));
import { askPlatformSkillQa } from "./platformSkillQa";
import { keyframeAdviceDraftFixture, keyframeAdvicePlanFixture } from "../../shared/digitalHumanKeyframeAdvice.fixtures";
import { makeDigitalHumanKeyframeAdviceTarget } from "../../client/src/lib/digitalHumanKeyframeAdvice";
import { buildDigitalHumanAdvisorProject } from "../../client/src/lib/digitalHumanAdvisor";
const draft = keyframeAdviceDraftFixture(), target = makeDigitalHumanKeyframeAdviceTarget(draft);
const context = { ...buildDigitalHumanAdvisorProject(draft).context, digitalHumanKeyframeAdvice: target };
const reply = (answer: unknown) => ({ choices: [{ message: { content: JSON.stringify({ answer, imageIntent: true }) } }] });
beforeEach(() => { vi.clearAllMocks(); mocks.video.mockResolvedValue({ url: "data:video/mp4;base64,dGVzdC1vbmx5", requestId: target.previs.previousPreviewRequestId, durationSec: 5 }); mocks.llm.mockResolvedValue(reply(keyframeAdvicePlanFixture(target))); });
it("真实审片分支附完整视频，保留候选结构，不挂Growth或改白模", async () => {
  const result = await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "审白模建议补图", manhuaContext: context });
  expect(mocks.video).toHaveBeenCalledWith(7, target.previs); expect(mocks.trends).not.toHaveBeenCalled();
  const input = mocks.llm.mock.calls[0][0]; expect(input.modelName).toBe("z-ai/glm-5.3-flashx");
  expect(input.messages.at(-1).content).toContainEqual({ type: "video_url", video_url: { url: "data:video/mp4;base64,dGVzdC1vbmx5" } });
  expect(JSON.stringify(input.messages)).toContain("视频理解不等于逐帧审片");
  expect(JSON.parse(result.answer)).toEqual(keyframeAdvicePlanFixture(target)); expect(result.imageOffer).toBeNull();
});
it.each(["missing", "owner"])("%s视频在LLM前拒绝", async kind => {
  if (kind === "missing") mocks.video.mockResolvedValue(null); else mocks.video.mockRejectedValue(Error("无权读取"));
  await expect(askPlatformSkillQa({ userId: 7, isAdmin: true, question: "审白模建议补图", manhuaContext: context })).rejects.toThrow();
  expect(mocks.llm).not.toHaveBeenCalled();
});
it("视频传输失败不调用纯文字后备，也不重复传视频", async () => {
  mocks.llm.mockRejectedValue(Error("test-only transport failure"));
  await expect(askPlatformSkillQa({ userId: 7, isAdmin: true, question: "审白模建议补图", manhuaContext: context })).rejects.toThrow();
  expect(mocks.llm).toHaveBeenCalledTimes(1);
});
it("坏时间候选同视频通道定向修正一次，视频始终保留", async () => {
  const bad = keyframeAdvicePlanFixture(target); bad.candidates[0].startSec = 1;
  mocks.llm.mockResolvedValueOnce(reply(bad)).mockResolvedValueOnce(reply(keyframeAdvicePlanFixture(target)));
  const result = await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "审白模建议补图", manhuaContext: context });
  expect(mocks.llm).toHaveBeenCalledTimes(2);
  for (const [input] of mocks.llm.mock.calls) { expect(input.modelName).toBe("z-ai/glm-5.3-flashx"); expect(JSON.stringify(input.messages)).toContain('"type":"video_url"'); }
  expect(JSON.stringify(mocks.llm.mock.calls[1][0].messages)).toContain("上一次补图建议未通过校验"); expect(JSON.parse(result.answer).candidates[0].startSec).toBe(11);
});
it("完整建议超过旧12000字上限时不截断", async () => {
  const plan = keyframeAdvicePlanFixture(target); plan.observations = Array.from({ length: 20 }, () => ({ atVideoSec: 1, actorIds: [], detailZh: "测试观察".repeat(200) }));
  mocks.llm.mockResolvedValue(reply(plan));
  const result = await askPlatformSkillQa({ userId: 7, isAdmin: true, question: "审白模建议补图", manhuaContext: context });
  expect(result.answer.length).toBeGreaterThan(12000); expect(JSON.parse(result.answer).observations).toHaveLength(20);
});
