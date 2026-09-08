import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";
const mocks = vi.hoisted(() => ({ objects: new Map<string, any>(), invoke: vi.fn(), inspect: vi.fn(), stat: vi.fn(), count: 9, withPages: vi.fn(), usePhysical: false }));
vi.mock("./gcs.js", () => ({
  getGcsBucketName: () => "test-bucket", inspectGcsObjectBounded: mocks.inspect, statGcsObjectVersion: mocks.stat,
  signGsUriV4ReadUrl: (uri: string) => `https://example.invalid/${encodeURIComponent(uri)}`,
}));
vi.mock("./knowledgeCardReadingStore.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./knowledgeCardReadingStore")>();
  return { ...actual, readKnowledgeReadingJson: async (name: string) => mocks.objects.get(name) ?? null,
    saveKnowledgeReadingObject: async (name: string, buffer: Buffer, type?: string) => {
      if (type !== "image/png") mocks.objects.set(name, JSON.parse(buffer.toString()));
      return { gcsUri: `gs://test-bucket/${name}`, sha256: actual.knowledgeReadingDigest(buffer) };
    } };
});
vi.mock("./knowledgeCardReadingGateway.js", () => ({ invokeKnowledgeReadingJson: mocks.invoke }));
vi.mock("./knowledgeCardDocumentPages.js", async importOriginal => {
  const actual = await importOriginal<typeof import("./knowledgeCardDocumentPages.js")>();
  return {
    withKnowledgeCardDocumentPages: (...args: Parameters<typeof actual.withKnowledgeCardDocumentPages>) => mocks.usePhysical ? actual.withKnowledgeCardDocumentPages(...args) : mocks.withPages(...args),
    iterateKnowledgeCardDocumentPages: async function* (manifest: Parameters<typeof actual.iterateKnowledgeCardDocumentPages>[0]) {
      if (mocks.usePhysical) { yield* actual.iterateKnowledgeCardDocumentPages(manifest); return; }
      for (let i = 1; i <= mocks.count; i++) yield { pageNumber: i, text: `原页${i}的数字和机制`, isBlankCandidate: false, imageBuffer: Buffer.from(`测试图片${i}`) };
    },
  };
});
import { analyzeKnowledgeCardDocuments, resolveKnowledgeReadingSources, validateKnowledgeReadingBatch } from "./knowledgeCardReading";
const input = { userId: 7, model: "gpt-5.6-sol" as const, files: [{ gcsUri: "gs://test-bucket/uploads/u7/original.pdf", generation: "12345", mimeType: "application/pdf", fileName: "原稿.pdf" }] };
const evidence = (page: any) => ({ id: page.id, documentId: page.documentId, pageNumber: page.pageNumber, status: "read", summary: `原页${page.pageNumber}摘要`, contentMarkdown: `数字${page.pageNumber}以及原图机制`, visuals: [], uncertainties: [] });
function makePlan(request: any) {
  return { version: 1, sourceDigest: request.sourceDigest, model: request.model, presentation: "single", reason: "四页足以讲清机制", options: [{ mode: "complete", reason: "覆盖全书知识", kept: ["完整主线"], omitted: [], pages: Array.from({ length: 4 }, (_, i) => ({ pageId: `card-${i + 1}`, title: `知识卡${i + 1}`, brief: "机制与条件", sourcePageIds: request.evidence.filter((page: any) => page.status === "read").map((page: any) => page.id), visualDirections: "重绘因果箭头与条件注释" })) }] };
}
describe("全页精读到报价的实际服务链", () => {
  beforeEach(() => {
    vi.clearAllMocks(); mocks.objects.clear(); mocks.count = 9; mocks.usePhysical = false;
    mocks.inspect.mockImplementation(async ({ onChunk }) => onChunk(Buffer.from("测试原件")));
    mocks.stat.mockResolvedValue({ generation: "12345" });
    mocks.withPages.mockImplementation(async (_input, callback) => callback({ sourceDigest: "a".repeat(64), totalPages: mocks.count }));
    mocks.invoke.mockImplementation(async (call: any) => { const data = JSON.parse(call.text); return Array.isArray(data) ? { pages: data.map(evidence).reverse() } : makePlan(data); });
  });
  it("九页全部分4/4/1批读取、按原页排序、证据永久保存后生成四页报价", async () => {
    const result = await analyzeKnowledgeCardDocuments(input);
    expect(result.sourcePages).toBe(9); expect(result.quote.options[0]).toMatchObject({ pageCount: 4, credits: 120, selectable: true });
    const calls = mocks.invoke.mock.calls.map(([call]) => call);
    expect(calls.slice(0, 3).map(call => call.images.length)).toEqual([4, 4, 1]);
    const inventory = JSON.parse(calls[3].text).evidence;
    expect(inventory.map((page: any) => page.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(inventory.every((page: any) => page.contentMarkdown.includes("原图机制"))).toBe(true);
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/analysis.json"))).toBe(true);
    expect(mocks.inspect.mock.calls[0][0]).toMatchObject({ generation: "12345", maxBytes: 200 * 1024 * 1024 });
  });
  it("同请求恢复不重复阅读或规划；约束改变复用阅读、单独重新规划", async () => {
    const first = await analyzeKnowledgeCardDocuments(input);
    mocks.invoke.mockClear(); mocks.inspect.mockClear();
    const cached = await analyzeKnowledgeCardDocuments(input);
    expect(cached).toEqual(first); expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
    const changed = await analyzeKnowledgeCardDocuments({ ...input, constraints: { budgetCredits: 119, targetPages: 5 } });
    expect(mocks.invoke).toHaveBeenCalledTimes(1); expect(mocks.inspect).not.toHaveBeenCalled();
    expect(changed.analysisId).toBe(first.analysisId); expect(changed.planId).not.toBe(first.planId);
    expect(changed.quote.options[0]).toMatchObject({ selectable: false, withinBudget: false, matchesTarget: false });
    expect(changed.quote.minimumBudgetUnreachable).toBe(true);
  });
  it("276页材料全部进入69个阅读批次及最终证据目录，无40页截断", async () => {
    mocks.count = 276;
    const result = await analyzeKnowledgeCardDocuments(input);
    expect(result.sourcePages).toBe(276); expect(mocks.invoke).toHaveBeenCalledTimes(70);
    const calls = mocks.invoke.mock.calls.map(([call]) => call);
    expect(calls.slice(0, 69).every(call => call.images.length === 4)).toBe(true);
    const inventory = JSON.parse(calls[69].text).evidence;
    expect(inventory).toHaveLength(276); expect(inventory.at(-1).pageNumber).toBe(276);
  });
  it("批次有上限并发：同时在读不超过上限，结果按原页顺序回填，一批失败后不再发新批", async () => {
    mocks.count = 40; process.env.KNOWLEDGE_CARD_READING_BATCH_CONCURRENCY = "3";
    let active = 0, peak = 0;
    const original = mocks.invoke.getMockImplementation()!;
    mocks.invoke.mockImplementation(async (call: any) => {
      const data = JSON.parse(call.text);
      if (!Array.isArray(data)) return original(call);
      active++; peak = Math.max(peak, active);
      await new Promise(resolve => setTimeout(resolve, data[0].pageNumber % 3 * 5));
      active--;
      return original(call);
    });
    const progress: number[] = [];
    const result = await analyzeKnowledgeCardDocuments(input, async done => { progress.push(done); });
    expect(result.sourcePages).toBe(40); expect(peak).toBe(3);
    expect(JSON.parse(mocks.invoke.mock.calls.at(-1)![0].text).evidence.map((page: any) => page.pageNumber)).toEqual(Array.from({ length: 40 }, (_, i) => i + 1));
    expect(progress).toEqual([...progress].sort((a, b) => a - b));
    mocks.objects.clear(); mocks.invoke.mockClear();
    mocks.invoke.mockImplementation(async (call: any) => { const data = JSON.parse(call.text); if (Array.isArray(data) && data[0].pageNumber === 5) throw new Error("测试第二批失败"); return original(call); });
    await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("测试第二批失败");
    expect(mocks.invoke.mock.calls.length).toBeLessThan(10);
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/analysis.json"))).toBe(false);
    delete process.env.KNOWLEDGE_CARD_READING_BATCH_CONCURRENCY;
  });
  it("超过五万字的真实文字原件完整进入阅读段并可恢复，不当单张物理页拒绝", async () => {
    mocks.usePhysical = true;
    const text = "a".repeat(11999) + "😀条件与机制\n" + "原文尾段 ".repeat(14000);
    mocks.inspect.mockImplementation(async ({ onChunk }) => onChunk(Buffer.from(text)));
    const textInput = { ...input, files: [{ ...input.files[0], mimeType: "text/markdown", fileName: "完整长文.md" }] };
    const result = await analyzeKnowledgeCardDocuments(textInput);
    const readCalls = mocks.invoke.mock.calls.map(([call]) => call).filter(call => Array.isArray(JSON.parse(call.text)));
    const sections = readCalls.flatMap(call => JSON.parse(call.text));
    expect(sections.map(section => section.extractedText).join("")).toBe(text);
    expect(sections.every(section => section.sourceFormat === "text" && section.extractedText.length <= 12000)).toBe(true);
    expect(readCalls.every(call => call.images.length === 0)).toBe(true);
    expect(result.sourcePages).toBe(sections.length);
    expect(result.plan.options[0].pages.every(page => page.sourcePageIds.length === sections.length)).toBe(true);
    mocks.invoke.mockClear(); mocks.inspect.mockClear();
    expect(await analyzeKnowledgeCardDocuments(textInput)).toEqual(result);
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("原件版本读取失败时不阅读、不使用其他版本补位", async () => {
    mocks.inspect.mockRejectedValue(new Error("测试版本不匹配"));
    await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("测试版本不匹配");
    expect(mocks.withPages).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("漏一页时终止，不落整书完成记录且不进入规划", async () => {
    mocks.invoke.mockImplementationOnce(async (call: any) => ({ pages: JSON.parse(call.text).slice(0, 3).map(evidence) }));
    await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("页数不一致");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/analysis.json"))).toBe(false);
  });
  it("含已提取正文的原页被模型报blank时拒绝，不能绕过完整覆盖", async () => {
    mocks.invoke.mockImplementationOnce(async (call: any) => ({ pages: JSON.parse(call.text).map((page: any, i: number) => i === 0 ? { ...evidence(page), status: "blank", summary: "空白页", contentMarkdown: "" } : evidence(page)) }));
    await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("误判为空白");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/analysis.json"))).toBe(false);
  });
  it("真实黑线图片无OCR文字也不能被模型报blank", async () => {
    mocks.usePhysical = true;
    const buffer = await sharp(Buffer.from('<svg width="512" height="512"><rect width="512" height="512" fill="white"/><path d="M20 200 H480" stroke="black" stroke-width="1"/></svg>')).png().toBuffer();
    mocks.inspect.mockImplementation(async ({ onChunk }) => onChunk(buffer));
    mocks.invoke.mockImplementationOnce(async (call: any) => ({ pages: JSON.parse(call.text).map((page: any) => ({ ...evidence(page), status: "blank", summary: "空白页", contentMarkdown: "" })) }));
    const imageInput = { ...input, files: [{ ...input.files[0], mimeType: "image/png", fileName: "实际线条.png" }] };
    await expect(analyzeKnowledgeCardDocuments(imageInput)).rejects.toThrow("误判为空白");
    expect(JSON.parse(mocks.invoke.mock.calls[0][0].text)[0].extractedText).toBe("");
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
  });
  it("真实白页计入全页覆盖且保存物理依据，缓存缺失依据后拒绝而不重买", async () => {
    mocks.usePhysical = true;
    const white = await sharp({ create: { width: 64, height: 64, channels: 3, background: "white" } }).png().toBuffer();
    const diagram = await sharp({ create: { width: 64, height: 64, channels: 3, background: "red" } }).png().toBuffer();
    const imageInput = { ...input, files: [
      { ...input.files[0], mimeType: "image/png", fileName: "白页.png", gcsUri: "gs://test-bucket/uploads/u7/white.png" },
      { ...input.files[0], mimeType: "image/png", fileName: "图示.png", gcsUri: "gs://test-bucket/uploads/u7/diagram.png" },
    ] };
    mocks.inspect.mockImplementation(async ({ gcsUri, onChunk }) => onChunk(gcsUri.endsWith("white.png") ? white : diagram));
    mocks.invoke.mockImplementation(async (call: any) => {
      const data = JSON.parse(call.text);
      return Array.isArray(data) ? { pages: data.map((page: any) => page.documentId.startsWith("d1-") ? { ...evidence(page), status: "blank", summary: "白页", contentMarkdown: "" } : evidence(page)) } : makePlan(data);
    });
    const result = await analyzeKnowledgeCardDocuments(imageInput);
    expect(result.sourcePages).toBe(2);
    const [key, saved] = Array.from(mocks.objects.entries()).find(([name]) => name.endsWith("/analysis.json"))!;
    expect(saved.pages.map((page: any) => [page.evidence.status, page.isBlankCandidate])).toEqual([["blank", true], ["read", false]]);
    mocks.invoke.mockClear(); mocks.inspect.mockClear();
    expect((await analyzeKnowledgeCardDocuments(imageInput)).sourcePages).toBe(2);
    delete saved.pages[0].isBlankCandidate; mocks.objects.set(key, saved);
    await expect(analyzeKnowledgeCardDocuments(imageInput)).rejects.toThrow("缺少物理原页核对依据");
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("批次缓存乱序时恢复为原页顺序，不重复调用阅读模型", async () => {
    await analyzeKnowledgeCardDocuments(input);
    for (const [key, value] of Array.from(mocks.objects)) {
      if (key.endsWith("/analysis.json")) mocks.objects.delete(key);
      if (key.endsWith("/parsed.json")) mocks.objects.set(key, [...value].reverse());
    }
    mocks.invoke.mockClear();
    await analyzeKnowledgeCardDocuments(input);
    expect(mocks.invoke).not.toHaveBeenCalled();
    const restored = Array.from(mocks.objects.entries()).find(([key]) => key.endsWith("/analysis.json"))![1];
    expect(restored.pages.map((page: any) => page.evidence.pageNumber)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });
  it("损坏整书缓存明确失败，不当作未命中重新购买", async () => {
    await analyzeKnowledgeCardDocuments(input);
    const [key, original] = Array.from(mocks.objects.entries()).find(([name]) => name.endsWith("/analysis.json"))!;
    mocks.invoke.mockClear(); mocks.inspect.mockClear();
    for (const mutation of [
      (value: any) => { value.analysisId = "错误身份"; },
      (value: any) => { value.model = "qwen3.8-max"; },
      (value: any) => { value.pages.pop(); },
      (value: any) => { value.sourceDigest = "b".repeat(64); },
    ]) {
      const corrupted = structuredClone(original); mutation(corrupted); mocks.objects.set(key, corrupted);
      await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow();
    }
    expect(mocks.invoke).not.toHaveBeenCalled(); expect(mocks.inspect).not.toHaveBeenCalled();
  });
  it("取消信号在读原件前停止", async () => {
    const controller = new AbortController(); controller.abort(new Error("测试取消"));
    await expect(analyzeKnowledgeCardDocuments(input, undefined, controller.signal)).rejects.toThrow("测试取消");
    expect(mocks.inspect).not.toHaveBeenCalled(); expect(mocks.invoke).not.toHaveBeenCalled();
  });
  it("拒绝他人文件及旧式Office源，版本锁定由服务端查询", async () => {
    await expect(resolveKnowledgeReadingSources(7, [{ ...input.files[0], gcsUri: "gs://test-bucket/uploads/u8/other.pdf" }])).rejects.toThrow("不属于");
    await expect(resolveKnowledgeReadingSources(7, [{ ...input.files[0], mimeType: "application/epub+zip" }])).rejects.toThrow("转换成PDF");
    expect(mocks.stat).not.toHaveBeenCalled();
    expect(await resolveKnowledgeReadingSources(7, input.files)).toEqual(input.files);
    expect(mocks.stat).toHaveBeenCalledWith({ gcsUri: input.files[0].gcsUri });
  });
  it("相同ID错页号、重复ID、伪空内容都不成为有效阅读证据", () => {
    const expected = [{ id: "d1-p1", documentId: "d1", pageNumber: 1 }];
    expect(() => validateKnowledgeReadingBatch({ pages: [{ ...evidence(expected[0]), pageNumber: 2 }] }, expected)).toThrow();
    expect(() => validateKnowledgeReadingBatch({ pages: [evidence(expected[0]), evidence(expected[0])] }, expected)).toThrow();
    expect(() => validateKnowledgeReadingBatch({ pages: [{ ...evidence(expected[0]), contentMarkdown: "" }] }, expected)).toThrow();
  });
  it("方案身份与实际阅读模型不一致时拒绝", async () => {
    mocks.invoke.mockImplementation(async (call: any) => { const data = JSON.parse(call.text); return Array.isArray(data) ? { pages: data.map(evidence) } : { ...makePlan(data), model: "qwen3.8-max" }; });
    await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("阅读档位不一致");
    expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/plan.json"))).toBe(false);
  });
  it.each([false, true])("完整方案漏页是否具备明确排除理由：%s", async explain => {
    mocks.invoke.mockImplementation(async (call: any) => {
      const data = JSON.parse(call.text);
      if (Array.isArray(data)) return { pages: data.map(evidence) };
      const value = makePlan(data);
      value.options[0].pages.forEach(page => { page.sourcePageIds = [data.evidence[0].id]; });
      if (explain) Object.assign(value.options[0], { sourceExclusions: data.evidence.slice(1).map((page: any) => ({ sourcePageId: page.id, reason: "本页为首个方法的重复目录，无独立知识" })) });
      return value;
    });
    if (!explain) {
      await expect(analyzeKnowledgeCardDocuments(input)).rejects.toThrow("未引用且未说明排除理由");
      expect(Array.from(mocks.objects.keys()).some(key => key.endsWith("/plan.json"))).toBe(false);
      return;
    }
    const result = await analyzeKnowledgeCardDocuments(input);
    expect(result.plan.options[0].sourceExclusions).toHaveLength(8);
    expect(Array.from(mocks.objects.values()).some(value => value?.options?.[0]?.sourceExclusions?.length === 8)).toBe(true);
  });
});
