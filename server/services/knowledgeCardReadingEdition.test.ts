import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ objects: new Map<string, any>(), invoke: vi.fn(), save: vi.fn(), purchases: 0 }));
vi.mock("./gcs.js", () => ({ getGcsBucketName: () => "test-bucket" }));
vi.mock("./knowledgeCardReadingStore.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./knowledgeCardReadingStore")>();
  return { ...actual,
    readKnowledgeReadingJson: async (name: string) => mocks.objects.has(name) ? structuredClone(mocks.objects.get(name)) : null,
    saveKnowledgeReadingObject: mocks.save,
  };
});
vi.mock("./knowledgeCardReadingGateway.js", () => ({ invokeKnowledgeReadingJson: mocks.invoke }));
import { knowledgeReadingDigest } from "./knowledgeCardReadingStore";
import { KNOWLEDGE_CARD_READING_CONTRACT, type KnowledgeReadingAnalysis } from "./knowledgeCardReading";
import { loadKnowledgeCardReadingPlan, prepareKnowledgeCardReadingEdition, loadKnowledgeCardReadingEdition } from "./knowledgeCardReadingEdition";

function seed(count = 3, images = true, constraints: { budgetCredits?: number; targetPages?: number } = {}) {
  const analysisId = "a".repeat(64);
  const analysisPrefix = `knowledge-card-reading/u7/${KNOWLEDGE_CARD_READING_CONTRACT}/${analysisId}`;
  const documentId = `d1-${"b".repeat(16)}`;
  const documents = [{ documentId, fileName: "测试原稿.pdf", pageCount: count, sourceDigest: "b".repeat(64) }];
  const analysis: KnowledgeReadingAnalysis = {
    version: 1, analysisId, sourceDigest: knowledgeReadingDigest(JSON.stringify(documents)), model: "gpt-5.6-sol", documents,
    pages: Array.from({ length: count }, (_, index) => ({ evidence: {
      id: `${documentId}-p${index + 1}`, documentId, pageNumber: index + 1, status: "read" as const,
      summary: `原页${index + 1}摘要`, contentMarkdown: `原页${index + 1}的机制、条件与数字`, visuals: [], uncertainties: [],
    }, ...(images ? { imageGsUri: `gs://test-bucket/${analysisPrefix}/${documentId}/page-${index + 1}.png`, imageSha256: "c".repeat(64) } : {}) })),
  };
  const plan = {
    version: 1, sourceDigest: analysis.sourceDigest, model: "gpt-5.6-sol", presentation: "single", reason: "原稿完整知识四页足够",
    options: [{ mode: "complete", reason: "覆盖全部条件与机制", kept: ["全部知识"], omitted: [], sourceExclusions: [],
      pages: Array.from({ length: 4 }, (_, index) => ({ pageId: `card-${index + 1}`, title: `知识卡${index + 1}`, brief: "解释机制及适用条件", sourcePageIds: analysis.pages.map(page => page.evidence.id), visualDirections: "按原图机制重组对照表格" })),
    }],
  };
  const planKey = knowledgeReadingDigest(JSON.stringify(constraints));
  const planPrefix = `${analysisPrefix}/plans/${planKey}`;
  mocks.objects.set(`${analysisPrefix}/analysis.json`, analysis);
  mocks.objects.set(`${planPrefix}/plan.json`, plan);
  mocks.objects.set(`${planPrefix}/constraints.json`, constraints);
  return { analysis, plan, planId: `${analysisId}-${planKey}`, planPrefix, analysisPrefix };
}
const request = (planId: string) => ({ userId: 7, planId, mode: "complete" as const });
function reply(call: any) {
  const data = JSON.parse(call.text);
  const last = data.sources.filter((page: any) => page.hasImage).at(-1);
  return { pageId: data.pageId, contentMarkdown: `## ${data.thisPage.title}\n说明机制、条件与完整数字。`, visualDirections: "横16:9重组原页表格，人物位置由用户指定，原图不锁脸", referencePageIds: last ? [last.id] : [] };
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.objects.clear(); mocks.purchases = 0;
  mocks.save.mockImplementation(async (name: string, buffer: Buffer) => {
    const value = JSON.parse(buffer.toString());
    if (mocks.objects.has(name) && JSON.stringify(mocks.objects.get(name)) !== JSON.stringify(value)) throw new Error("不可覆盖旧产物");
    mocks.objects.set(name, value);
    return { gcsUri: `gs://test-bucket/${name}`, sha256: knowledgeReadingDigest(buffer) };
  });
  mocks.invoke.mockImplementation(async (call: any) => {
    const key = `${call.objectPrefix}/raw.json`;
    if (mocks.objects.has(key)) return structuredClone(mocks.objects.get(key));
    mocks.purchases++;
    const out = reply(call);
    mocks.objects.set(key, structuredClone(out));
    return out;
  });
});

describe("确认方案到冻结详细页稿", () => {
  it("四页逐页生成后统一冻结；带齐知识来源与目录，模型自主选择最后一张原页参考", async () => {
    const { planId, analysis } = seed();
    const progress = vi.fn(async () => undefined);
    const edition = await prepareKnowledgeCardReadingEdition(request(planId), progress);
    expect(edition).toMatchObject({ planId, mode: "complete", model: "gpt-5.6-sol", credits: 120 });
    expect(edition.pages).toHaveLength(4);
    expect(edition.pages.map(page => page.ordinal)).toEqual([1, 2, 3, 4]);
    for (const page of edition.pages) {
      expect(page.contentMarkdown).toContain("机制、条件与完整数字");
      expect(page.sourcePageIds).toEqual(analysis.pages.map(source => source.evidence.id));
      expect(page.referencePageIds).toEqual([analysis.pages[2]!.evidence.id]);
      expect(page.imageGsUris).toEqual([analysis.pages[2]!.imageGsUri]);
    }
    for (const [call] of mocks.invoke.mock.calls) {
      const data = JSON.parse(call.text);
      expect(data.sources).toHaveLength(3);
      expect(data.planDirectory).toHaveLength(4);
      expect(call.model).toBe("gpt-5.6-sol");
      expect(call.channelScope).toMatch(/^knowledge-card-reading\/u\d+\/visual-reading-v1\/[a-f0-9]{64}$/);
      expect(call.system).toContain("不绑定人物脸部");
      expect(call.system).toContain("如果原稿");
    }
    const keys = mocks.save.mock.calls.map(([key]) => key);
    expect(keys.slice(0, 4).every(key => key.endsWith("/parsed.json"))).toBe(true);
    expect(keys.at(-1)).toBe(`knowledge-card-reading/u7/editions/${edition.editionId}.json`);
    expect(progress).toHaveBeenLastCalledWith(4, 4, "done");
    expect(await loadKnowledgeCardReadingEdition(7, edition.editionId)).toEqual(edition);
  });
  it("冻结后重复准备只返回同版本，不再次调用模型，纯文字页允许空参考", async () => {
    const { planId } = seed(2, false);
    const first = await prepareKnowledgeCardReadingEdition(request(planId));
    expect(first.pages.every(page => !page.referencePageIds.length && !page.imageGsUris.length && page.visualDirections.length > 0)).toBe(true);
    mocks.invoke.mockClear();
    expect(await prepareKnowledgeCardReadingEdition(request(planId))).toEqual(first);
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("其他账号无法读取方案/冻结版，路径穿越和非法用户在读存储前拒绝", async () => {
    const { planId } = seed();
    const edition = await prepareKnowledgeCardReadingEdition(request(planId));
    mocks.invoke.mockClear();
    await expect(loadKnowledgeCardReadingPlan(8, planId)).rejects.toThrow("当前账号");
    await expect(loadKnowledgeCardReadingEdition(8, edition.editionId)).rejects.toThrow("当前账号");
    await expect(loadKnowledgeCardReadingPlan(7, "../u7/plan")).rejects.toThrow();
    await expect(loadKnowledgeCardReadingEdition(0, edition.editionId)).rejects.toThrow("登录");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("预算低于四页或目标页数不匹配时，详细编稿之前拒绝且不新收费", async () => {
    for (const constraints of [{ budgetCredits: 119 }, { targetPages: 5 }]) {
      const { planId } = seed(3, true, constraints);
      await expect(prepareKnowledgeCardReadingEdition(request(planId))).rejects.toThrow("预算/页数");
    }
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("约束哈希、来源摘要、模型或全页覆盖损坏时均不得继续", async () => {
    let value = seed();
    mocks.objects.set(`${value.planPrefix}/constraints.json`, { budgetCredits: 1 });
    await expect(loadKnowledgeCardReadingPlan(7, value.planId)).rejects.toThrow("约束");
    value = seed(); value.plan.sourceDigest = "d".repeat(64);
    await expect(loadKnowledgeCardReadingPlan(7, value.planId)).rejects.toThrow("摘要");
    value = seed(); value.analysis.model = "qwen3.8-max";
    await expect(loadKnowledgeCardReadingPlan(7, value.planId)).rejects.toThrow("身份");
    value = seed(); value.analysis.pages.pop();
    await expect(loadKnowledgeCardReadingPlan(7, value.planId)).rejects.toThrow("页数");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("原页图片不得借跨账号URI或缺摘要的伪证据", async () => {
    const value = seed();
    value.analysis.pages[0]!.imageGsUri = "gs://test-bucket/knowledge-card-reading/u8/stolen.png";
    await expect(loadKnowledgeCardReadingPlan(7, value.planId)).rejects.toThrow("当前账号");
    const next = seed(); next.analysis.pages[0]!.imageSha256 = "";
    await expect(loadKnowledgeCardReadingPlan(7, next.planId)).rejects.toThrow("已验证");
  });
  it.each(["unknown", "duplicate", "tooMany", "wrongPage", "empty", "tooLong", "overrideSources"])("模型返回%s时不截断、不冻结，原始回复保留", async kind => {
    const { planId, analysis } = seed(17);
    mocks.invoke.mockImplementation(async (call: any) => {
      const out = reply(call);
      if (kind === "unknown") out.referencePageIds = ["unknown-page"];
      if (kind === "duplicate") out.referencePageIds = [analysis.pages[0]!.evidence.id, analysis.pages[0]!.evidence.id];
      if (kind === "tooMany") out.referencePageIds = analysis.pages.map(page => page.evidence.id);
      if (kind === "wrongPage") out.pageId = "wrong";
      if (kind === "empty") out.contentMarkdown = " ";
      if (kind === "tooLong") out.contentMarkdown = "字".repeat(8001);
      if (kind === "overrideSources") Object.assign(out, { sourcePageIds: ["伪造知识来源"] });
      mocks.objects.set(`${call.objectPrefix}/raw.json`, out);
      return out;
    });
    await expect(prepareKnowledgeCardReadingEdition(request(planId))).rejects.toThrow();
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/raw.json"))).toBe(true);
    expect(Array.from(mocks.objects.keys()).some(key => /editions\/[a-f0-9]{64}\.json$/.test(key))).toBe(false);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("有图片但不属于该页来源的参考，以及无实际图片的文本页参考均拒绝", async () => {
    const first = seed();
    first.plan.options[0]!.pages[0]!.sourcePageIds = [first.analysis.pages[0]!.evidence.id];
    mocks.invoke.mockImplementation(async (call: any) => ({ ...reply(call), referencePageIds: [first.analysis.pages[2]!.evidence.id] }));
    await expect(prepareKnowledgeCardReadingEdition(request(first.planId))).rejects.toThrow("本页知识来源");
    const second = seed(3, false);
    mocks.invoke.mockImplementation(async (call: any) => ({ ...reply(call), referencePageIds: [second.analysis.pages[0]!.evidence.id] }));
    await expect(prepareKnowledgeCardReadingEdition(request(second.planId))).rejects.toThrow("实际具有图片");
  });
  it("模型可从20张来源中自主选择16张并保留选择顺序，程序不取前16张", async () => {
    const { planId, analysis } = seed(20);
    const selected = analysis.pages.map(page => page.evidence.id).reverse().slice(0, 16);
    mocks.invoke.mockImplementation(async (call: any) => ({ ...reply(call), referencePageIds: selected }));
    const edition = await prepareKnowledgeCardReadingEdition(request(planId));
    expect(edition.pages[0]!.referencePageIds).toEqual(selected);
    expect(edition.pages[0]!.imageGsUris).toEqual(selected.map(id => analysis.pages.find(page => page.evidence.id === id)!.imageGsUri));
  });
  it("完整输入超出容量时明确拒绝，不能裁证据或偷偷调用模型", async () => {
    const { planId, analysis } = seed(20);
    for (const page of analysis.pages) page.evidence.contentMarkdown = "原稿知识".repeat(8_000);
    await expect(prepareKnowledgeCardReadingEdition(request(planId))).rejects.toThrow("不能截断资料");
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("中途失败留下前页parsed，恢复只补未完成页，所有页齐才冻结", async () => {
    const { planId } = seed();
    const normal = mocks.invoke.getMockImplementation()!;
    let once = true;
    mocks.invoke.mockImplementation(async (call: any) => {
      if (once && JSON.parse(call.text).pageOrdinal === 3) { once = false; throw new Error("当前调用结果待对账"); }
      return normal(call);
    });
    await expect(prepareKnowledgeCardReadingEdition(request(planId))).rejects.toThrow("待对账");
    expect(Array.from(mocks.objects.keys()).filter(key => key.endsWith("/parsed.json"))).toHaveLength(2);
    expect(Array.from(mocks.objects.keys()).some(key => /editions\/[a-f0-9]{64}\.json$/.test(key))).toBe(false);
    mocks.invoke.mockClear();
    const edition = await prepareKnowledgeCardReadingEdition(request(planId));
    expect(edition.pages).toHaveLength(4);
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.purchases).toBe(4);
  });
  it("abort不启动后续页或冻结，已保存页稿保留，signal送达网关", async () => {
    const { planId } = seed();
    const controller = new AbortController();
    await expect(prepareKnowledgeCardReadingEdition(request(planId), async done => { if (done === 2) controller.abort(new Error("用户停止")); }, controller.signal)).rejects.toThrow("用户停止");
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
    expect(mocks.invoke.mock.calls[0]![0].signal).toBe(controller.signal);
    expect(Array.from(mocks.objects.keys()).filter(key => key.endsWith("/parsed.json"))).toHaveLength(2);
    expect(Array.from(mocks.objects.keys()).some(key => /editions\/[a-f0-9]{64}\.json$/.test(key))).toBe(false);
  });
  it("晚到模型回执原样保留，但中止后不写parsed也不冻结", async () => {
    const { planId } = seed();
    const controller = new AbortController();
    const normal = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (call: any) => { const out = await normal(call); controller.abort(new Error("超时")); return out; });
    await expect(prepareKnowledgeCardReadingEdition(request(planId), undefined, controller.signal)).rejects.toThrow("超时");
    expect(Array.from(mocks.objects.keys()).filter(key => key.endsWith("/raw.json"))).toHaveLength(1);
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("读取冻结版再次检查页数、单价、页序和图片对应，不能借改缓存降价或换图", async () => {
    const { planId } = seed();
    const edition = await prepareKnowledgeCardReadingEdition(request(planId));
    const key = `knowledge-card-reading/u7/editions/${edition.editionId}.json`;
    for (const modify of [
      (value: any) => { value.credits = 1; },
      (value: any) => { value.pages.pop(); },
      (value: any) => { value.pages[0].ordinal = 2; },
      (value: any) => { value.pages[0].sourcePageIds = ["伪造知识来源"]; },
      (value: any) => { value.pages[0].imageGsUris = ["gs://other/forged.png"]; },
    ]) {
      const changed = structuredClone(edition); modify(changed); mocks.objects.set(key, changed);
      await expect(loadKnowledgeCardReadingEdition(7, edition.editionId)).rejects.toThrow();
    }
  });
  it("已存在但损坏的parsed不是缓存未命中，不重新购买修复", async () => {
    const { planId } = seed();
    const controller = new AbortController();
    await expect(prepareKnowledgeCardReadingEdition(request(planId), async done => { if (done === 1) controller.abort(); }, controller.signal)).rejects.toThrow();
    const parsedKey = Array.from(mocks.objects.keys()).find(key => key.endsWith("/parsed.json"))!;
    mocks.objects.set(parsedKey, false);
    mocks.invoke.mockClear();
    await expect(prepareKnowledgeCardReadingEdition(request(planId))).rejects.toThrow();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
