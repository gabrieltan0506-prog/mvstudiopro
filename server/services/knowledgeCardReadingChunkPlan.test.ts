import { describe, expect, it, vi } from "vitest";
import { planKnowledgeCardReadingChunks, type KnowledgeCardReadingChunkPlanInput } from "./knowledgeCardReadingChunkPlan";
import type { KnowledgeCardReadingEvidencePage } from "../../shared/knowledgeCardReadingPlan";
const evidence = (n: number, chars = 300): KnowledgeCardReadingEvidencePage[] => Array.from({ length: n }, (_, i) => ({ id: `source-${i + 1}`, documentId: "book", pageNumber: i + 1, status: "read", summary: `第${i + 1}页机制`, contentMarkdown: `原文${i + 1}：${"正文机制数字条件".repeat(chars)}`, visuals: [], uncertainties: [] }));
function fixture(pages = evidence(12)) {
  const saved = new Map<string, unknown>();
  const invoke = vi.fn(async (call: { text: string }) => {
    const data = JSON.parse(call.text);
    if (data.statements) return { statements: [data.statements.join("；")] };
    return { options: ["concise", "balanced", "complete"].map(mode => ({
      mode, reason: `${mode}按真实知识规划`, kept: ["关键机制与数字"], omitted: mode === "complete" ? [] : ["省略次要案例及重复解释"], sourceExclusions: [],
      pages: Array.from({ length: Math.max(1, data.minimumPagesByMode[mode] || 0) }, (_, i) => ({ pageId: `local-${i + 1}`, title: `机制${i + 1}`, brief: `第${i + 1}项实际知识`, sourcePageIds: data.evidenceUnits.map((unit: { id: string }) => unit.id), visualDirections: "以条件和机制的图文对照表示" })),
    })) };
  });
  const input: KnowledgeCardReadingChunkPlanInput = { evidence: pages, sourceDigest: "a".repeat(64), model: "gpt-5.6-sol", objectPrefix: "knowledge-card-reading/u7/test", maxInputChars: 8192, invoke,
    storage: { read: async path => saved.get(path) ?? null, write: async (path, value) => { saved.set(path, structuredClone(value)); } },
  };
  return { input, invoke, saved };
}
describe("全书证据分批规划协调器", () => {
  it("大书自然方案超过80页仍完整交付，不把旧请求容量当整书页数上限", async () => {
    const f = fixture(evidence(180));
    const plan = await planKnowledgeCardReadingChunks(f.input);
    const complete = plan.options.find(option => option.mode === "complete")!;
    expect(complete.pages.length).toBeGreaterThan(80);
    expect(new Set(complete.pages.flatMap(page => page.sourcePageIds)).size).toBe(180);
  });
  it("超过200条真实取舍按有界批汇总，缓存恢复不重复调用", async () => {
    const f = fixture(evidence(240, 500)); const original = f.invoke.getMockImplementation()!;
    f.invoke.mockImplementation(async call => {
      const data = JSON.parse(call.text);
      if (data.statements) return { statements: [data.statements.join("；")] };
      const raw = await original(call);
      for (const option of raw.options!) { option.kept = [`第${data.batchIndex}部分机制`]; if (option.mode !== "complete") option.omitted = [`第${data.batchIndex}部分次要案例`]; }
      return raw;
    });
    const plan = await planKnowledgeCardReadingChunks(f.input);
    expect(f.invoke.mock.calls.some(([call]) => JSON.parse(call.text).statements)).toBe(true);
    expect(plan.options.every(option => option.kept.length <= 200 && option.omitted.length <= 200)).toBe(true);
    const count = f.invoke.mock.calls.length;
    await planKnowledgeCardReadingChunks(f.input);
    expect(f.invoke).toHaveBeenCalledTimes(count);
  });
  it("多批允许局部1页，合并连续全书页码并保持每个原页真实覆盖", async () => {
    const f = fixture();
    const plan = await planKnowledgeCardReadingChunks(f.input);
    expect(f.invoke.mock.calls.length).toBeGreaterThan(4);
    expect(plan.presentation).toBe("options");
    const complete = plan.options.find(option => option.mode === "complete")!;
    expect(complete.pages.length).toBe(f.invoke.mock.calls.length);
    expect(complete.pages.map(page => page.pageId)).toEqual(complete.pages.map((_, i) => `complete-p${i + 1}`));
    expect(new Set(complete.pages.flatMap(page => page.sourcePageIds))).toEqual(new Set(f.input.evidence.map(page => page.id)));
    for (const [call] of f.invoke.mock.calls) {
      expect(call.text.length).toBeLessThanOrEqual(8192);
      expect(JSON.parse(call.text)).not.toHaveProperty("wholeBookConstraints");
    }
  });
  it("失败后复用已经验证的相同checkpoint，不重新调用已完成批", async () => {
    const f = fixture(); const original = f.invoke.getMockImplementation()!;
    let failed = false;
    f.invoke.mockImplementation(async call => { if (f.invoke.mock.calls.length === 3 && !failed) { failed = true; throw new Error("中途失败"); } return original(call); });
    await expect(planKnowledgeCardReadingChunks(f.input)).rejects.toThrow("中途失败");
    expect(f.saved.size).toBe(2);
    const firstPaths = Array.from(f.saved.keys());
    f.invoke.mockClear();
    const resumed = await planKnowledgeCardReadingChunks(f.input);
    const paths = f.invoke.mock.calls.map(([call]) => (call as { objectPrefix?: string }).objectPrefix);
    for (const path of firstPaths) expect(paths).not.toContain(path.replace(/\/parsed.json$/, ""));
    f.invoke.mockClear();
    expect(await planKnowledgeCardReadingChunks(f.input)).toEqual(resumed);
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("超长原页无损分片，全部原始JSON片段按序拼回原文，最终仍引用真实原页", async () => {
    const f = fixture(evidence(1, 5000));
    const plan = await planKnowledgeCardReadingChunks(f.input);
    const units = f.invoke.mock.calls.flatMap(([call]) => JSON.parse(call.text).evidenceUnits);
    expect(units.map(unit => unit.serializedEvidence).join("")).toBe(JSON.stringify(f.input.evidence[0]));
    expect(plan.options.every(option => option.pages.every(page => page.sourcePageIds.every(id => id === "source-1")))).toBe(true);
  });
  it("小书不足4页时只追加一次局部展开，不复制页面，完整4页返回单方案", async () => {
    const f = fixture(evidence(1, 1));
    const plan = await planKnowledgeCardReadingChunks(f.input);
    expect(f.invoke).toHaveBeenCalledTimes(2);
    expect(JSON.parse(f.invoke.mock.calls[1]![0].text).minimumPagesByMode).toEqual({ concise: 4, balanced: 4, complete: 4 });
    expect(plan.presentation).toBe("single"); expect(plan.options).toHaveLength(1); expect(plan.options[0]!.pages).toHaveLength(4);
  });
  it("单批全书约束只传一次全书语义，多批未接通的目标分配明确拒绝而非每批重复预算", async () => {
    const f = fixture(evidence(1, 1));
    await planKnowledgeCardReadingChunks({ ...f.input, constraints: { targetPages: 4, budgetCredits: 120 } });
    expect(JSON.parse(f.invoke.mock.calls[0]![0].text).wholeBookConstraints).toEqual({ targetPages: 4, budgetCredits: 120 });
    const big = fixture();
    await expect(planKnowledgeCardReadingChunks({ ...big.input, constraints: { budgetCredits: 120 } })).rejects.toThrow("跨批分配");
    expect(big.invoke).not.toHaveBeenCalled();
  });
  it("异来源引用、漏证据、重复档位、空规划都在写checkpoint之前拒绝", async () => {
    for (const change of [
      (raw: any) => { raw.options[0].pages[0].sourcePageIds = ["other-book"]; },
      (raw: any) => { raw.options[2].pages[0].sourcePageIds.pop(); },
      (raw: any) => { raw.options[1].mode = "concise"; },
      (raw: any) => { raw.options[2].pages = []; },
    ]) {
      const f = fixture(); const original = f.invoke.getMockImplementation()!;
      f.invoke.mockImplementation(async call => { const raw = await original(call); change(raw); return raw; });
      await expect(planKnowledgeCardReadingChunks(f.input)).rejects.toThrow();
      expect(f.saved.size).toBe(0);
    }
  });
  it("中止时不进入模型，缓存损坏也不会通过新购买掩盖", async () => {
    const f = fixture(); const controller = new AbortController(); controller.abort(new Error("用户停止"));
    await expect(planKnowledgeCardReadingChunks({ ...f.input, signal: controller.signal })).rejects.toThrow("用户停止");
    expect(f.invoke).not.toHaveBeenCalled();
    await planKnowledgeCardReadingChunks(f.input); f.invoke.mockClear();
    f.saved.set(Array.from(f.saved.keys())[0]!, { options: [] });
    await expect(planKnowledgeCardReadingChunks(f.input)).rejects.toThrow();
    expect(f.invoke).not.toHaveBeenCalled();
  });
  it("读取checkpoint或保存失败不返回虚假方案", async () => {
    const f = fixture();
    await expect(planKnowledgeCardReadingChunks({ ...f.input, storage: { ...f.input.storage, read: async () => { throw new Error("读取失败"); } } })).rejects.toThrow("读取失败");
    expect(f.invoke).not.toHaveBeenCalled();
    await expect(planKnowledgeCardReadingChunks({ ...f.input, storage: { ...f.input.storage, write: async () => { throw new Error("保存失败"); } } })).rejects.toThrow("保存失败");
  });
});
