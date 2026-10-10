import { describe, it, expect, vi, beforeEach } from "vitest";
const invoke = vi.hoisted(() => vi.fn());
vi.mock("../_core/llm.js", async () => ({ ...await vi.importActual("../_core/llm.js"), invokeLLM: invoke }));
import { polishPlatformPersona } from "./platformPersonaPolish";
import { MANHUA_ADVISOR_HOPS } from "./openrouterDeepSeekV41Flash";
const result = (text: string, reason = "stop") => ({ choices: [{ message: { content: text }, finish_reason: reason }] });
describe("人物润色下架模型迁移", () => {
  beforeEach(() => invoke.mockReset());
  it("无效JSON及截断结果切备用，最终读取真实文案", async () => {
    invoke.mockRejectedValueOnce(new Error("断线")).mockResolvedValueOnce(result("非JSON"))
      .mockResolvedValueOnce(result('{"polished":"截断"}', "length"))
      .mockResolvedValueOnce(result('{"polished":"茶馆经营者，分享茶饮知识","changes":["归纳身份"]}'));
    expect((await polishPlatformPersona({ persona: "茶馆经营者", tier: "superb" })).polished).toContain("茶饮知识");
    expect(invoke.mock.calls.map(([p]) => [p.modelName, p.openAiGateway])).toEqual(MANHUA_ADVISOR_HOPS.map(h => [h.modelName, h.gateway]));
  });
  it("四次失败后终止，不把空对象当有效润色", async () => {
    invoke.mockResolvedValue(result("{}"));
    await expect(polishPlatformPersona({ persona: "原文保留", tier: "superb" })).rejects.toThrow("算力紧张");
    expect(invoke).toHaveBeenCalledTimes(4);
  });
});
