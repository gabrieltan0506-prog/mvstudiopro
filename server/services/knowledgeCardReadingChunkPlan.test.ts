import { describe, expect, it, vi } from "vitest";
import { allocateCondenseTargets, planKnowledgeCardReadingChunks, resolveWholeBookCondenseTarget, type KnowledgeCardReadingChunkPlanInput } from "./knowledgeCardReadingChunkPlan";
import type { KnowledgeCardReadingEvidencePage } from "../../shared/knowledgeCardReadingPlan";
const evidence = (n: number, chars = 300): KnowledgeCardReadingEvidencePage[] => Array.from({ length: n }, (_, i) => ({ id: `source-${i + 1}`, documentId: "book", pageNumber: i + 1, status: "read", summary: `第${i + 1}页机制`, contentMarkdown: `原文${i + 1}：${"正文机制数字条件".repeat(chars)}`, visuals: [], uncertainties: [] }));
function fixture(pages = evidence(12)) {
  const saved = new Map<string, unknown>();
  const invoke = vi.fn(async (call: { text: string }) => {
    const data = JSON.parse(call.text);
    if (data.statements) return { statements: [data.statements.join("；")] };
    if (data.targetPages !== undefined) {
      const ids: string[] = data.pages.map((page: { pageId: string }) => page.pageId);
      const size = Math.ceil(ids.length / data.targetPages);
      return { pages: Array.from({ length: data.targetPages }, (_, i) => ({ pageId: `m${i + 1}`, title: `合并主题${i + 1}`, brief: "合并后的真实内容", visualDirections: "合并后的图文对照", mergedFrom: ids.slice(i * size, (i + 1) * size) })), omitted: [`第${data.groupIndex}组因合并压缩的次要案例`] };
    }
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
  it("单批全书约束只传一次全书语义；多批时约束不进每批，而是合并后对精简方案统一分配", async () => {
    const f = fixture(evidence(1, 1));
    await planKnowledgeCardReadingChunks({ ...f.input, constraints: { targetPages: 4, budgetCredits: 120 } });
    expect(JSON.parse(f.invoke.mock.calls[0]![0].text).wholeBookConstraints).toEqual({ targetPages: 4, budgetCredits: 120 });
    const big = fixture();
    const natural = await planKnowledgeCardReadingChunks(big.input);
    const naturalConcise = natural.options.find(option => option.mode === "concise")!;
    expect(naturalConcise.pages.length).toBeGreaterThan(4);
    const batchCalls = big.invoke.mock.calls.length;
    const plan = await planKnowledgeCardReadingChunks({ ...big.input, constraints: { targetPages: 4 } });
    const condenseCalls = big.invoke.mock.calls.slice(batchCalls).map(([call]) => JSON.parse(call.text));
    expect(condenseCalls.length).toBeGreaterThan(0);
    expect(condenseCalls.every(call => call.targetPages !== undefined && call.evidenceUnits === undefined)).toBe(true);
    expect(condenseCalls.reduce((sum, call) => sum + call.targetPages, 0)).toBe(4);
    const concise = plan.options.find(option => option.mode === "concise")!;
    expect(concise.pages).toHaveLength(4);
    expect(concise.pages.map(page => page.pageId)).toEqual(["concise-p1", "concise-p2", "concise-p3", "concise-p4"]);
    expect(new Set(concise.pages.flatMap(page => page.sourcePageIds))).toEqual(new Set(naturalConcise.pages.flatMap(page => page.sourcePageIds)));
    expect(concise.reason).toContain("合并为4页");
    expect(concise.omitted.some(item => item.includes("因合并压缩"))).toBe(true);
    expect(plan.options.find(option => option.mode === "complete")!.pages).toEqual(natural.options.find(option => option.mode === "complete")!.pages);
    const rerun = big.invoke.mock.calls.length;
    await planKnowledgeCardReadingChunks({ ...big.input, constraints: { targetPages: 4 } });
    expect(big.invoke.mock.calls.length).toBe(rerun);
    // 换一种约束（预算折算同样4页）：自然批checkpoint复用，只重做合并调用，缓存身份与提示词入参一致。
    await planKnowledgeCardReadingChunks({ ...big.input, constraints: { budgetCredits: 120 } });
    expect(big.invoke.mock.calls.slice(rerun).every(([call]) => JSON.parse(call.text).targetPages !== undefined)).toBe(true);
  });
  it("预算不足4页、已有方案可选或目标超过预算时不合并，交给报价如实显示", async () => {
    const counts = { concise: 6, balanced: 9, complete: 12 };
    expect(resolveWholeBookCondenseTarget({ budgetCredits: 30 }, "gpt-5.6-sol", counts)).toBeNull();
    expect(resolveWholeBookCondenseTarget({ targetPages: 6 }, "gpt-5.6-sol", counts)).toBeNull();
    expect(resolveWholeBookCondenseTarget({ targetPages: 20 }, "gpt-5.6-sol", counts)).toBeNull();
    expect(resolveWholeBookCondenseTarget({ targetPages: 5, budgetCredits: 120 }, "gpt-5.6-sol", counts)).toBeNull();
    expect(resolveWholeBookCondenseTarget({ targetPages: 5 }, "gpt-5.6-sol", counts)).toBe(5);
    expect(resolveWholeBookCondenseTarget({ budgetCredits: 120 }, "gpt-5.6-sol", counts)).toBe(4);
    const f = fixture();
    await planKnowledgeCardReadingChunks({ ...f.input, constraints: { budgetCredits: 30 } });
    expect(f.invoke.mock.calls.every(([call]) => JSON.parse(call.text).targetPages === undefined)).toBe(true);
  });
  it("目标页数按各组页数比例分配，每组至少1页且不超过现有页数", () => {
    expect(allocateCondenseTargets([10, 10], 4)).toEqual([2, 2]);
    expect(allocateCondenseTargets([9, 1, 30], 5)).toEqual([1, 1, 3]);
    expect(allocateCondenseTargets([3, 3, 3], 8)).toEqual([3, 3, 2]);
    expect(allocateCondenseTargets([1, 1, 100], 4)).toEqual([1, 1, 2]);
    expect(allocateCondenseTargets([50, 1, 1, 1], 5)).toEqual([2, 1, 1, 1]);
    expect(() => allocateCondenseTargets([5, 5, 5, 5, 5], 4)).toThrow("提高预算或目标页数");
    expect(() => allocateCondenseTargets([2, 2], 4)).toThrow("无需合并");
  });
  it("合并结果丢页、重复归并或页数不符时拒绝，不写checkpoint", async () => {
    for (const change of [
      (raw: any) => { raw.pages[0].mergedFrom.pop(); },
      (raw: any) => { raw.pages[1].mergedFrom.push(raw.pages[0].mergedFrom[0]); },
      (raw: any) => { raw.pages.pop(); },
      (raw: any) => { raw.pages[0].mergedFrom.push("other-group-page"); },
      (raw: any) => { raw.pages[0].mergedFrom.push(raw.pages[0].mergedFrom[0]); },
    ]) {
      const f = fixture(); const original = f.invoke.getMockImplementation()!;
      await planKnowledgeCardReadingChunks(f.input);
      const before = f.saved.size;
      f.invoke.mockImplementation(async call => { const raw = await original(call); if (JSON.parse(call.text).targetPages !== undefined) change(raw); return raw; });
      await expect(planKnowledgeCardReadingChunks({ ...f.input, constraints: { targetPages: 4 } })).rejects.toThrow();
      expect(f.saved.size).toBe(before);
    }
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
  it("组数多于目标页数时放弃合并交给报价，不让整次规划失败；规划调用透传避让范围", async () => {
    const f = fixture(evidence(400));
    const plan = await planKnowledgeCardReadingChunks({ ...f.input, channelScope: "scope-1", constraints: { targetPages: 4 } });
    expect(plan.options.find(option => option.mode === "concise")!.pages.length).toBeGreaterThan(4);
    expect(f.invoke.mock.calls.every(([call]) => JSON.parse(call.text).targetPages === undefined && (call as any).channelScope === "scope-1")).toBe(true);
  });
});
