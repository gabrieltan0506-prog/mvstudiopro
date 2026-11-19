import { beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
// 1119 C4：大稿分段暂存 → 摘要报价 → 摘要逐页出图；全部走真实 routers 与真实暂存模块，只桩对象存储、账本与出图供应商边界。
const mocks = vi.hoisted(() => ({
  objects: new Map<string, string>(), readFail: { on: false }, uploadFail: { on: false }, downloads: [] as string[], refs: vi.fn(),
  reserve: vi.fn(), credits: vi.fn(), deduct: vi.fn(), image: vi.fn(), lookup: vi.fn(), succeeded: vi.fn(), failed: vi.fn(),
}));
vi.mock("./services/gcs", async original => ({
  ...await original<any>(),
  getGcsBucketName: () => "test-bucket",
  uploadBufferToGcs: vi.fn(async (p: { objectName: string; buffer: Buffer; ifGenerationMatch?: string }) => {
    if (mocks.uploadFail.on) throw new Error(`gcs_upload_failed:403:{"error":{"message":"svc@proj.iam.gserviceaccount.com does not have storage.objects.create access to the Google Cloud Storage object test-bucket/${p.objectName}"}}`);
    if (p.ifGenerationMatch === "0" && mocks.objects.has(p.objectName)) throw new Error("gcs_upload_failed:412 precondition");
    mocks.objects.set(p.objectName, p.buffer.toString("utf8"));
    return { bucket: "test-bucket", objectName: p.objectName, gcsUri: `gs://test-bucket/${p.objectName}` };
  }),
  downloadGcsObjectVersioned: vi.fn(async (p: { gcsUri: string }) => {
    if (mocks.readFail.on) throw new Error("gcs_download_failed:503");
    const name = p.gcsUri.replace("gs://test-bucket/", "");
    mocks.downloads.push(name);
    await new Promise(r => setTimeout(r, 1));
    if (!mocks.objects.has(name)) throw new Error("gcs_stat_failed:404");
    return { buffer: Buffer.from(mocks.objects.get(name)!, "utf8"), bucket: "test-bucket", objectName: name, generation: "1" };
  }),
}));
vi.mock("./services/knowledgeCardDistillReceipt.js", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
vi.mock("./services/knowledgeCardDistillReceipt", () => ({ lookupKnowledgeCardDistillReceiptModel: mocks.lookup }));
vi.mock("./jobs/knowledgeCardPageTask", async original => ({ ...await original<any>(), reserveKnowledgeCardImageJob: mocks.reserve, checkKnowledgeCardImageMaySubmit: async () => {} }));
vi.mock("./credits", async original => ({ ...await original<any>(), getCredits: mocks.credits, deductCreditsAmount: mocks.deduct }));
vi.mock("./services/knowledgeImageFailure", () => ({ markKnowledgeImageFailed: mocks.failed }));
vi.mock("./jobs/repository", async original => ({ ...await original<any>(), markJobSucceeded: mocks.succeeded }));
vi.mock("./services/proxyImageService.js", async original => ({ ...await original<any>(), generatePlatformCompositeSheetImage: mocks.image, appendImageFlowLog: (log: string[], value: string) => log.push(value) }));
vi.mock("./services/knowledgeCardDocumentPages.js", async original => ({ ...await original<any>(), resolveKnowledgeCardReferencePageUrls: mocks.refs }));
vi.mock("./jobs/compositeSheetLiveProgress.js", () => ({ attachCompositeSheetFlowLogLiveSync: () => () => {} }));
vi.mock("./services/tier-provider-routing", async original => ({ ...await original<any>(), resolveWatermark: async () => false }));
vi.mock("./services/paidJobLedger.js", async original => ({ ...await original<any>(), registerActiveJob: async () => {}, refundCreditsOnFailure: async () => ({ refunded: true }), unregisterActiveJob: async () => {}, markSettlementPending: async () => true }));
import { appRouter } from "./routers";
import { planKnowledgeCardPages, KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS, knowledgeCardCreditsForPageIndex } from "../shared/knowledgeCardPagination";
import { __clearHandbookManuscriptCacheForTest, finalizeHandbookManuscript, loadHandbookManuscript, stageHandbookManuscriptChunk, HandbookManuscriptError } from "./services/handbookManuscriptStage";
import { quoteKnowledgeCard } from "./services/knowledgeCardPricing";
import { hydrateStagedManuscriptRows } from "./services/knowledgeCardRecovery";
import { stageHandbookManuscript, handbookManuscriptPageBody, handbookManuscriptDigest as clientDigest, __resetHandbookManuscriptStageForTest } from "../client/src/lib/handbookManuscriptStage";

/**
 * 1119 C4 对抗审查：大稿暂存路径的计费一致性、篡改、故障与缓存。
 * 每个拒绝都断言零占位、零查余额、零扣费、零出图。
 */
const sha = (t: string) => createHash("sha256").update(t, "utf8").digest("hex");
const caller = (id = 7) => appRouter.createCaller({ user: { id, role: "user" } } as never);
const MODEL = "deepseek-v4.1-flash-1017";
const C = KNOWLEDGE_CARD_MAX_MANUSCRIPT_CHARS;
function book(chars: number, crlf = false) {
  const parts: string[] = ["﻿# 大书 𝒜"]; let i = 0;
  while (parts.join("\n\n").length < chars) parts.push(`## 第${++i}节\n${`知识点${i}：光合作用把光能转化为化学能 😀。 `.repeat(30)}`);
  const t = parts.join(crlf ? "\r\n\r\n" : "\n\n");
  return t.slice(0, chars);
}
/** 浏览器 → tRPC（superjson 外层仍是 JSON 文本）→ 服务端：一次真实的 JSON 往返 */
const wire = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
const clientApi = (user = 7) => ({
  stageChunk: (i: any) => caller(user).mvAnalysis.stageKnowledgeCardManuscriptChunk(wire(i)),
  finalize: (i: any) => caller(user).mvAnalysis.finalizeKnowledgeCardManuscript(wire(i)),
});
const noSideEffects = () => {
  expect(mocks.reserve).not.toHaveBeenCalled(); expect(mocks.credits).not.toHaveBeenCalled();
  expect(mocks.deduct).not.toHaveBeenCalled(); expect(mocks.image).not.toHaveBeenCalled();
};
const RID = "12345678-1234-4123-8123-123456789abc";
const base = { sceneId: "big", title: "大书", kind: "single_page_knowledge_card" as const, distillModel: MODEL, openaiImageVariant: "sunburst" as const };

beforeEach(() => {
  vi.clearAllMocks(); mocks.objects.clear(); mocks.readFail.on = false; mocks.uploadFail.on = false; mocks.downloads.length = 0;
  __clearHandbookManuscriptCacheForTest(); __resetHandbookManuscriptStageForTest();
  mocks.reserve.mockResolvedValue({ id: "kc_page_job", claimed: true });
  mocks.credits.mockResolvedValue({ totalAvailable: 100_000 });
  mocks.deduct.mockImplementation(async (_u: number, cost: number) => ({ cost, source: "personal" }));
  mocks.image.mockResolvedValue("https://test.invalid/ok.png");
  mocks.lookup.mockResolvedValue(null);
  mocks.refs.mockResolvedValue([]);
});

/** 服务层直接封存（绕开路由 20 万字下限），用于把同一份 ≤20 万字稿件强制走暂存路径做差分 */
async function sealViaService(text: string, user = 7) {
  const digest = sha(text), count = Math.ceil(text.length / C);
  for (let index = 0; index < count; index++) await stageHandbookManuscriptChunk(user, { digest, index, count, totalChars: text.length, text: text.slice(index * C, (index + 1) * C) });
  await finalizeHandbookManuscript(user, { digest, count, totalChars: text.length });
  return digest;
}

describe("计费一致性：同一份稿件旧路径与暂存路径逐项相同", () => {
  it("19.999 万字（BOM + CRLF + 星芒字符）：报价、回执哈希入参、页码校验、扣费额与备注、出图入参、参考页入参完全一致", async () => {
    const text = book(199_990, true);
    expect(text.startsWith("﻿")).toBe(true); expect(text).toContain("\r\n"); expect(text).toMatch(/[\uD800-\uDBFF][\uDC00-\uDFFF]/);
    const plan = planKnowledgeCardPages(text);
    const digest = await sealViaService(text);
    mocks.lookup.mockResolvedValue(MODEL);
    const legacyQuote = await caller().mvAnalysis.quoteKnowledgeCardForGeneration(wire({ markdown: text, distillModel: "x" }));
    const legacyLookup = mocks.lookup.mock.calls.at(-1);
    const stagedQuote = await caller().mvAnalysis.quoteKnowledgeCardForGeneration(wire({ manuscriptDigest: digest, distillModel: "x" }));
    expect(stagedQuote).toEqual(legacyQuote);
    expect(mocks.lookup.mock.calls.at(-1)).toEqual(legacyLookup);
    expect(mocks.lookup.mock.calls.at(-1)![1]).toBe(text);
    const page = 3, credits = knowledgeCardCreditsForPageIndex(page, legacyQuote.billingModel);
    const common = { ...base, confirmedPageCredits: credits, notePageIndex: page, notePageTotal: plan.pageCount, pageRequestId: RID };
    const run = async (input: any) => {
      vi.clearAllMocks(); mocks.lookup.mockResolvedValue(MODEL); mocks.reserve.mockResolvedValue({ id: "kc_page_job", claimed: true });
      mocks.credits.mockResolvedValue({ totalAvailable: 100_000 }); mocks.deduct.mockImplementation(async (_u: number, cost: number) => ({ cost, source: "personal" }));
      mocks.image.mockResolvedValue("https://test.invalid/ok.png"); mocks.refs.mockResolvedValue([]);
      await caller().mvAnalysis.generatePlatformCompositeSheet(wire(input));
      await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
      const { flowLog, beforeImageSubmit, ...image } = mocks.image.mock.calls[0][0];
      void flowLog; void beforeImageSubmit;
      const [u, cost, kind, note, opts] = mocks.deduct.mock.calls[0];
      return { lookup: mocks.lookup.mock.calls, deduct: [u, cost, kind, note, String(opts.chargeKey).replace(/[^/]+$/, "OP")], image, refs: mocks.refs.mock.calls };
    };
    const legacy = await run({ ...common, scriptContext: text });
    const staged = await run({ ...common, manuscriptDigest: digest, pageBody: plan.pages[page - 1] });
    expect(staged).toEqual(legacy);
    expect(staged.image.scriptContext).toBe(text.trim());
  });

  it("20 万字边界上的星芒字符（代理对跨段）+ CRLF + BOM：客户端切段经 JSON 往返，服务端拼回逐字相同，摘要一致，报价等于旧报价函数", async () => {
    let text = book(450_000, true);
    text = text.slice(0, C - 1) + "😀" + text.slice(C + 1);
    expect(text.length).toBe(450_000);
    expect(text.charCodeAt(C - 1)).toBe(0xd83d); expect(text.charCodeAt(C)).toBe(0xde00);
    const digest = await stageHandbookManuscript(text, clientApi());
    expect(digest).toBe(sha(text));
    expect(await clientDigest(text)).toBe(sha(text));
    const chunk0 = JSON.parse(mocks.objects.get(`knowledge-card-manuscript/user-7/${digest}/chunk-0.json`)!);
    expect(chunk0.text.length).toBe(C); expect(chunk0.text.charCodeAt(C - 1)).toBe(0xd83d);
    __clearHandbookManuscriptCacheForTest();
    expect(await loadHandbookManuscript(7, digest)).toBe(text);
    const quote = await caller().mvAnalysis.quoteKnowledgeCardForGeneration(wire({ manuscriptDigest: digest, distillModel: MODEL }));
    expect(quote).toEqual(await quoteKnowledgeCard(7, text, MODEL, mocks.lookup));
    expect(mocks.lookup.mock.calls[0]).toEqual([7, text]);
    // 客户端本页正文与服务端核对一致：每一页都能过核对（抽首、中、末页）
    const plan = planKnowledgeCardPages(text);
    for (const page of [1, Math.ceil(plan.pageCount / 2), plan.pageCount]) {
      vi.clearAllMocks(); mocks.reserve.mockResolvedValue({ id: "kc_page_job", claimed: true }); mocks.credits.mockResolvedValue({ totalAvailable: 100_000 });
      mocks.deduct.mockImplementation(async (_u: number, cost: number) => ({ cost, source: "personal" })); mocks.image.mockResolvedValue("https://x/ok.png"); mocks.lookup.mockResolvedValue(null); mocks.refs.mockResolvedValue([]);
      await caller().mvAnalysis.generatePlatformCompositeSheet(wire({ ...base, confirmedPageCredits: knowledgeCardCreditsForPageIndex(page, quote.billingModel), notePageIndex: page, notePageTotal: plan.pageCount, pageRequestId: RID, manuscriptDigest: digest, pageBody: handbookManuscriptPageBody(text, page) }));
      await vi.waitFor(() => expect(mocks.image).toHaveBeenCalledTimes(1));
      expect(mocks.deduct.mock.calls[0][1]).toBe(knowledgeCardCreditsForPageIndex(page, quote.billingModel));
    }
  });
});

describe("篡改与越界：全部在占位与扣费之前拒绝", () => {
  const BIG = book(450_000);
  const PLAN = planKnowledgeCardPages(BIG);
  const sealed = async (user = 7) => stageHandbookManuscript(BIG, clientApi(user));
  const gen = (extra: Record<string, unknown>, user = 7) => caller(user).mvAnalysis.generatePlatformCompositeSheet({ ...base, confirmedPageCredits: 30, notePageTotal: PLAN.pageCount, pageRequestId: RID, ...extra } as any);

  it("页码 0 / 负数 / 小数 / 超出总页数，与他稿正文：零副作用", async () => {
    const digest = await sealed();
    for (const notePageIndex of [0, -1, 1.5]) await expect(gen({ manuscriptDigest: digest, pageBody: PLAN.pages[0], notePageIndex })).rejects.toThrow();
    await expect(gen({ manuscriptDigest: digest, pageBody: PLAN.pages[0], notePageIndex: PLAN.pageCount + 1 })).rejects.toThrow("不一致");
    const other = book(300_000).replace(/光合作用/g, "呼吸作用");
    await expect(gen({ manuscriptDigest: digest, pageBody: planKnowledgeCardPages(other).pages[0], notePageIndex: 1 })).rejects.toThrow("不一致");
    await expect(gen({ manuscriptDigest: digest, notePageIndex: 1 })).rejects.toThrow("本页正文");
    noSideEffects();
  });

  it("摘要非 64 位小写十六进制 / 路径穿越：零写入、零副作用", async () => {
    for (const digest of ["A".repeat(64), "a".repeat(63), `../${"a".repeat(61)}`, `${"a".repeat(62)}/x`]) {
      await expect(caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index: 0, count: 3, totalChars: 450_000, text: "x".repeat(C) })).rejects.toThrow();
      await expect(caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count: 3, totalChars: 450_000 })).rejects.toThrow();
      await expect(caller().mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest } as any)).rejects.toThrow();
      await expect(gen({ manuscriptDigest: digest, pageBody: "x", notePageIndex: 1 })).rejects.toThrow();
    }
    expect(mocks.objects.size).toBe(0); noSideEffects();
  });

  it("段数/字数撒谎、段号越界、段长不符：拒绝且零写入", async () => {
    const digest = sha(BIG), t = (i: number) => BIG.slice(i * C, (i + 1) * C);
    const s = (x: any) => caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, ...x });
    await expect(s({ index: 0, count: 2, totalChars: BIG.length, text: t(0) })).rejects.toThrow("分段数");
    await expect(s({ index: 3, count: 3, totalChars: BIG.length, text: t(0) })).rejects.toThrow("序号");
    await expect(s({ index: 0, count: 3, totalChars: BIG.length, text: t(0).slice(1) })).rejects.toThrow("长度");
    await expect(s({ index: 2, count: 3, totalChars: BIG.length + 1, text: t(2) })).rejects.toThrow("长度");
    expect(mocks.objects.size).toBe(0);
  });

  it("封存前缺段不写清单；封存后改写某段被拒、全文不变；同前缀两本稿互不干扰", async () => {
    const digest = sha(BIG);
    await caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index: 0, count: 3, totalChars: BIG.length, text: BIG.slice(0, C) });
    await expect(caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count: 3, totalChars: BIG.length })).rejects.toThrow("缺第 2、3 段");
    expect([...mocks.objects.keys()].some(k => k.endsWith("manifest.json"))).toBe(false);
    await sealed();
    const snapshot = new Map(mocks.objects);
    await expect(caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index: 2, count: 3, totalChars: BIG.length, text: "改".repeat(BIG.length - 2 * C) })).rejects.toThrow("内容不同");
    expect(mocks.objects).toEqual(snapshot);
    const twin = BIG.slice(0, 2 * C) + "异".repeat(BIG.length - 2 * C);
    __resetHandbookManuscriptStageForTest();
    const twinDigest = await stageHandbookManuscript(twin, clientApi());
    __clearHandbookManuscriptCacheForTest();
    expect(await loadHandbookManuscript(7, digest)).toBe(BIG);
    expect(await loadHandbookManuscript(7, twinDigest)).toBe(twin);
  });

  it("两个标签页并发上传同一本：都成功，只有一份清单，内容一致", async () => {
    const digest = sha(BIG), count = 3;
    const upload = async () => {
      for (let index = 0; index < count; index++) await caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest, index, count, totalChars: BIG.length, text: BIG.slice(index * C, (index + 1) * C) });
      return caller().mvAnalysis.finalizeKnowledgeCardManuscript({ digest, count, totalChars: BIG.length });
    };
    const [a, b] = await Promise.all([upload(), upload()]);
    expect(a).toEqual(b);
    expect([...mocks.objects.keys()].filter(k => k.endsWith("manifest.json"))).toHaveLength(1);
    expect(await loadHandbookManuscript(7, digest)).toBe(BIG);
  });

  it("他人摘要：即便同稿已被用户 7 读入进程缓存，用户 8 未上传仍取不到", async () => {
    const digest = await sealed(7);
    await loadHandbookManuscript(7, digest);
    await expect(caller(8).mvAnalysis.quoteKnowledgeCardForGeneration({ manuscriptDigest: digest })).rejects.toThrow("尚未完整上传");
    await expect(gen({ manuscriptDigest: digest, pageBody: PLAN.pages[0], notePageIndex: 1 }, 8)).rejects.toThrow("尚未完整上传");
    noSideEffects();
  });
});

describe("存储故障：不返回部分文本，不泄露存储细节", () => {
  const BIG = book(450_000);
  const PLAN = planKnowledgeCardPages(BIG);
  const gen = (digest: string) => caller().mvAnalysis.generatePlatformCompositeSheet({ ...base, confirmedPageCredits: 30, notePageTotal: PLAN.pageCount, pageRequestId: RID, manuscriptDigest: digest, pageBody: PLAN.pages[0], notePageIndex: 1 } as any);
  it("清单在但缺一段 / 段被改 / 段非 JSON：零副作用，分别报缺段、损坏、暂时读不到", async () => {
    const digest = await stageHandbookManuscript(BIG, clientApi());
    const name = (i: number) => `knowledge-card-manuscript/user-7/${digest}/chunk-${i}.json`;
    const keep = mocks.objects.get(name(1))!;
    __clearHandbookManuscriptCacheForTest(); mocks.objects.delete(name(1));
    await expect(gen(digest)).rejects.toThrow("缺第 2 段");
    __clearHandbookManuscriptCacheForTest(); mocks.objects.set(name(1), JSON.stringify({ ...JSON.parse(keep), text: "坏".repeat(C) }));
    await expect(gen(digest)).rejects.toThrow("不一致");
    __clearHandbookManuscriptCacheForTest(); mocks.objects.set(name(1), keep.slice(0, 1000));
    await expect(gen(digest)).rejects.toThrow("暂时读不到");
    noSideEffects();
  });
  it("分段写入失败：前台只见业务句，不见桶名、服务账号、存储响应体", async () => {
    mocks.uploadFail.on = true;
    const err = await caller().mvAnalysis.stageKnowledgeCardManuscriptChunk({ digest: sha(BIG), index: 0, count: 3, totalChars: BIG.length, text: BIG.slice(0, C) }).catch(e => e);
    expect(err.message).toContain("请稍后重试");
    expect(err.message).not.toMatch(/gcs|bucket|iam|storage\.objects|test-bucket/i);
  });
});

describe("全文缓存：并发冷读只取一次，最近使用不被挤出", () => {
  const BIG = book(450_000);
  it("6 路并发逐页请求冷读同一本：清单与每段各只下载一次", async () => {
    const digest = await stageHandbookManuscript(BIG, clientApi());
    __clearHandbookManuscriptCacheForTest(); mocks.downloads.length = 0;
    const texts = await Promise.all(Array.from({ length: 6 }, () => loadHandbookManuscript(7, digest)));
    expect(new Set(texts)).toEqual(new Set([BIG]));
    expect(mocks.downloads.filter(n => n.endsWith("manifest.json"))).toHaveLength(1);
    expect(mocks.downloads.filter(n => n.endsWith("chunk-0.json"))).toHaveLength(1);
  });
  it("A 被反复使用时，另外 4 本轮流读入不会把 A 挤出（最近使用淘汰）", async () => {
    const books = Array.from({ length: 5 }, (_, i) => book(200_001 + i));
    const digests: string[] = [];
    for (const b of books) { __resetHandbookManuscriptStageForTest(); digests.push(await stageHandbookManuscript(b, clientApi())); }
    __clearHandbookManuscriptCacheForTest();
    for (const d of digests.slice(0, 4)) await loadHandbookManuscript(7, d);
    await loadHandbookManuscript(7, digests[0]);
    await loadHandbookManuscript(7, digests[4]);
    mocks.downloads.length = 0;
    expect(await loadHandbookManuscript(7, digests[0])).toBe(books[0]);
    expect(mocks.downloads).toEqual([]);
  });
});

describe("恢复取回大稿：确定取不回才跳过，暂时读不到必须报错", () => {
  const row = { id: "new", userId: "7", status: "succeeded", createdAt: new Date(), output: {}, input: { action: "platform_composite_sheet_progress", params: { kind: "single_page_knowledge_card", manuscriptDigest: "a".repeat(64), notePageIndex: 1, notePageTotal: 2 } } };
  it("UNAVAILABLE 或未知错误：整体报错（不把缺图恢复当成功）；NOT_FOUND / CONFLICT：跳过该行", async () => {
    await expect(hydrateStagedManuscriptRows([row], async () => { throw new HandbookManuscriptError("暂时读不到", "UNAVAILABLE"); })).rejects.toThrow("暂时读不到");
    await expect(hydrateStagedManuscriptRows([row], async () => { throw new Error("socket hang up"); })).rejects.toThrow("socket");
    expect(await hydrateStagedManuscriptRows([row], async () => { throw new HandbookManuscriptError("未封存", "NOT_FOUND"); })).toEqual([]);
    expect(await hydrateStagedManuscriptRows([row], async () => { throw new HandbookManuscriptError("不一致", "CONFLICT"); })).toEqual([]);
  });
});
