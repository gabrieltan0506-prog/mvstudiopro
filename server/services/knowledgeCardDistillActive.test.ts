import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("./gpt56CopywritingGateway.js", () => ({ getEvolinkApiKey: () => "test-key" }));
import { prepareKnowledgeCardCopy } from "./knowledgeCardDistill";
import {
  KNOWLEDGE_CARD_DISTILL_MODEL_CLAUDE as claude,
  KNOWLEDGE_CARD_DISTILL_MODEL_KIMI as kimi,
  KNOWLEDGE_CARD_DISTILL_MODEL_SOL as sol,
  KNOWLEDGE_CARD_DISTILL_MODEL_QWEN as qwen,
  KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS,
  resolveActiveKnowledgeCardDistillModel,
  resolveKnowledgeCardDistillModel,
  knowledgeCardPageCreditsForModel,
  knowledgeCardDistillFeeForModel,
} from "../../shared/knowledgeCardDistillModels";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("知识卡仅开放精细和轻量，历史账本独立保留", () => {
  it("新选项只有两档，旧模型和旧环境默认均迁到精细", () => {
    expect(KNOWLEDGE_CARD_DISTILL_MODEL_OPTIONS.map(x => x.id)).toEqual([sol, qwen]);
    for (const removed of [claude, kimi]) {
      expect(resolveActiveKnowledgeCardDistillModel(removed)).toBe(sol);
      vi.stubEnv("KNOWLEDGE_CARD_DISTILL_MODEL", removed);
      expect(resolveActiveKnowledgeCardDistillModel()).toBe(sol);
    }
    expect(resolveActiveKnowledgeCardDistillModel(qwen)).toBe(qwen);
  });

  it("旧回执保持历史模型和积分，不降价或重算", () => {
    expect(resolveKnowledgeCardDistillModel(claude)).toBe(claude);
    expect(resolveKnowledgeCardDistillModel(kimi)).toBe(kimi);
    expect(knowledgeCardPageCreditsForModel(claude)).toEqual({ full: 36, discount: 29 });
    expect(knowledgeCardPageCreditsForModel(kimi)).toEqual({ full: 27, discount: 22 });
    expect(knowledgeCardDistillFeeForModel(claude)).toBe(60);
    expect(knowledgeCardDistillFeeForModel(kimi)).toBe(40);
  });

  it.each([sol, qwen])("新请求 %s 只发明确选择的模型", async (requested) => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: "# 工作方法\n\n## 确认目标\n- 制作前先确认读者、资料范围和成品张数，避免漏项。" } }],
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const result = await prepareKnowledgeCardCopy({
      sourceText: "制作前确认资料范围和读者。", forceDistill: true, distillModel: requested,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    const expected = requested === qwen ? qwen : sol;
    expect(body.model).toBe(expected);
    expect(result.distillModel).toBe(expected);
    expect(result.distilledMarkdown).toContain("确认目标");
    expect(fetchMock.mock.calls[0][0]).toContain("evolink");
  });
  it.each([claude, kimi])("旧队列%s在抽文及模型调用之前拒绝，不静默换档", async distillModel => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    const input = { sourceText: "原始材料", forceDistill: true, distillModel,
      files: [{ gcsUri: "gs://test-bucket/uploads/u7/unread.pdf", mimeType: "application/pdf" }] };
    const original = JSON.stringify(input);
    await expect(prepareKnowledgeCardCopy(input)).rejects.toMatchObject({ code: "KNOWLEDGE_CARD_MODEL_RETIRED" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(input)).toBe(original);
  });

});
