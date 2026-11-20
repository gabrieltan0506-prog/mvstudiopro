/**
 * 只传变更的保存（saveDocuments）与整库解析缓存（1121 夜）。
 * 数据经正式 schema 生成（layoutFromSource / layoutLibrarySchema / knowledgeReviewPageSchema），结构与今晚线上大书一致。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { layoutFromSource, layoutLibrarySchema, type EditableLayout, type LayoutLibrary } from "../../shared/editableLayout";
import { knowledgeReviewPageSchema } from "../../shared/knowledgePublication";
import { buildLayoutSaveDelta, cloneLayoutTree, LayoutDeltaNeedsFull } from "../../shared/editableLayoutDelta";
import {
  LayoutConflict, layoutExternalTextCache, layoutLibraryBufferCache, layoutParsedLibraryCache, layoutSourceRetainDigest,
  readCanonicalLayoutLibrary, readLayoutLibrary, writeLayoutLibrary, writeLayoutLibraryDelta,
} from "./editableLayoutStore";
import { saveLayoutLibraryToCloud, layoutCloudBaseline } from "../../client/src/lib/editableLayoutCloudSave";

const OWNER = 7;
const noMedia = { normalize: async () => undefined, sign: (s: string) => s } as any;
const filler = "资治通鉴卷一周纪一威烈王二十三年初命晋大夫魏斯赵籍韩虔为诸侯臣光曰臣闻天子之职莫大于礼礼莫大于分分莫大于名何谓礼纪纲是也何谓分君臣是也何谓名公侯卿大夫是也。";
const text = (head: string, chars: number) => (head + filler.repeat(Math.ceil(chars / filler.length) + 1)).slice(0, chars);

function book(tag: string, chapters: number, supplementChars: number): EditableLayout {
  return layoutFromSource({
    kind: "knowledge-publication", owner: String(OWNER), sourceId: `src-${tag}`, title: `${tag}（完整版）`, body: "",
    detailLevel: "full", readingContract: "image-primary-v1", reviewBatchMode: "ready-images", inputFingerprint: "a".repeat(64),
    pages: Array.from({ length: chapters }, (_, i) => ({
      headline: `${tag} 第${i + 1}章`, body: text(`${tag}第${i + 1}章正文：`, 200), pageIndex: i + 1,
      imageJobId: `job_${tag}_${i + 1}`, knowledgeRole: "illustration" as const, supplement: text(`【${tag}·第${i + 1}章图外内文】`, supplementChars),
    })),
  });
}
const plain = (tag: string) => layoutFromSource({ owner: String(OWNER), sourceId: `plain-${tag}`, title: tag, body: `${tag}的正文` });
const lib = (documents: EditableLayout[]): LayoutLibrary => layoutLibrarySchema.parse({ version: 1, owner: String(OWNER), documents });
/** 审校一批（ready-images：一章一批）完成后的稿：写入该章审校结果。 */
function reviewOne(doc: EditableLayout, chapter: number): EditableLayout {
  const page = doc.publication!.source.pages[chapter];
  const review = knowledgeReviewPageSchema.parse({
    id: page.id, headline: page.headline, body: text(`审校稿${chapter}：`, 3000), imageDescription: "图中人物与器物与正文一致",
    imageStatus: "consistent", facts: [{ term: `事${chapter}`, statement: text("事实", 120) }], cautions: [],
  });
  return { ...doc, publication: { ...doc.publication!, chapterReviewDigest: "b".repeat(64), chapterReviews: { ...doc.publication!.chapterReviews, [page.id]: review } } };
}

function storage(withStat = true) {
  const map = new Map<string, { buffer: Buffer; generation: string }>();
  const uploads: { objectName: string; bytes: number }[] = [];
  const deps: any = {
    map, uploads,
    write: vi.fn(async (i: any) => {
      const old = map.get(i.objectName);
      if (i.ifGenerationMatch !== (old?.generation || "0")) throw new Error("gcs_upload_failed:412:{}");
      uploads.push({ objectName: i.objectName, bytes: i.buffer.length });
      const value = { buffer: i.buffer, generation: String(Number(old?.generation || 0) + 1) };
      map.set(i.objectName, value);
      return value;
    }),
    read: vi.fn(async (i: any) => {
      const value = map.get(i.gcsUri.match(/editable-layouts\/.*$/)[0]);
      if (!value) throw new Error("gcs_stat_failed:404");
      return value;
    }),
  };
  if (withStat) deps.stat = vi.fn(async (i: any) => {
    const value = map.get(i.gcsUri.match(/editable-layouts\/.*$/)[0]);
    if (!value) throw new Error("gcs_stat_failed:404");
    return { generation: value.generation };
  });
  return deps;
}
const INDEX = `editable-layouts/user-${OWNER}/library.json`;
const reset = () => { layoutExternalTextCache.clear(); layoutLibraryBufferCache.clear(); layoutParsedLibraryCache.clear(); };
const nodeDigest = async (source: object) => layoutSourceRetainDigest(source);

/** 模拟前台：基线来自云端读取；保存走与页面相同的 saveLayoutLibraryToCloud。 */
async function client(deps: any, protocol: "delta" | "full") {
  const read = await readLayoutLibrary(OWNER, deps, noMedia);
  let baseline = layoutCloudBaseline(read.generation, read.library, String(OWNER));
  let generation = read.generation;
  const sent: number[] = [];
  return {
    get generation() { return generation; },
    sent,
    async save(library: LayoutLibrary) {
      const out = await saveLayoutLibraryToCloud({
        input: { library, expectedGeneration: generation }, baseline, deltaUnsupported: protocol === "full", digest: nodeDigest,
        saveDelta: async delta => { sent.push(Buffer.byteLength(JSON.stringify(delta))); return writeLayoutLibraryDelta(OWNER, JSON.parse(JSON.stringify(delta)), deps, noMedia) as any; },
        saveFull: async input => { sent.push(Buffer.byteLength(JSON.stringify(input))); return writeLayoutLibrary(OWNER, JSON.parse(JSON.stringify(input.library)), input.expectedGeneration, deps, noMedia) as any; },
      });
      baseline = out.baseline; generation = out.result.generation;
      return out;
    },
  };
}

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-21T04:00:00.000Z")); reset(); });
afterEach(() => { vi.useRealTimers(); reset(); });

describe("只传变更：与整库上传逐字相同", () => {
  it("新建、加大书、逐批审校、改别的稿、重排、删稿：新旧协议每一步云端库字节相同", async () => {
    const a = storage(), b = storage();
    const initial = lib([plain("首稿")]);
    await writeLayoutLibrary(OWNER, initial, "0", a, noMedia);
    await writeLayoutLibrary(OWNER, initial, "0", b, noMedia);
    const full = await client(a, "full"), delta = await client(b, "delta");
    let state = (await readLayoutLibrary(OWNER, a, noMedia)).library!;
    const big = book("大书", 6, 55_000), small = plain("小稿");
    const steps: [string, (l: LayoutLibrary) => LayoutLibrary][] = [
      ["新建大书", l => lib([...l.documents, big])],
      ["新建小稿", l => lib([...l.documents, small])],
      ["审校第1批", l => lib(l.documents.map(d => d.id === big.id ? reviewOne(d, 0) : d))],
      ["审校第2批", l => lib(l.documents.map(d => d.id === big.id ? reviewOne(d, 1) : d))],
      ["改小稿", l => lib(l.documents.map(d => d.id === small.id ? { ...d, title: "小稿·改", updatedAt: "2026-11-21T04:00:05.000Z" } : d))],
      ["重排", l => lib([...l.documents].reverse())],
      ["删稿", l => lib(l.documents.filter(d => d.id !== small.id))],
    ];
    for (const [name, step] of steps) {
      state = step(state);
      const fa = await full.save(state), fb = await delta.save(state);
      expect(fa.mode, name).toBe("full");
      expect(fb.mode, name).toBe("delta");
      expect(b.map.get(INDEX)!.buffer.equals(a.map.get(INDEX)!.buffer), name).toBe(true);
      expect(fb.result.generation).toBe(fa.result.generation);
    }
    // 审校批次保存：只传变更的上传量远小于整库
    expect(delta.sent[3]).toBeLessThan(full.sent[3] / 20);
  }, 60_000);

  it("原稿快照真的变了：新协议上传全文并照样被同一校验拒绝；旧接口不变", async () => {
    const deps = storage();
    const big = book("大书", 3, 9000);
    await writeLayoutLibrary(OWNER, lib([big]), "0", deps, noMedia);
    const c = await client(deps, "delta");
    const changed = lib([{ ...big, publication: { ...big.publication!, source: { ...big.publication!.source, title: "改了原稿" } } }]);
    const delta = await buildLayoutSaveDelta((await readLayoutLibrary(OWNER, deps, noMedia)).library!, changed, "1", nodeDigest);
    expect(delta.upserts[0].retainSource).toBeUndefined();
    expect((delta.upserts[0].doc as any).publication.source.title).toBe("改了原稿");
    await expect(c.save(changed)).rejects.toThrow("原稿快照不能覆盖");
    await expect(writeLayoutLibrary(OWNER, changed, "1", deps, noMedia)).rejects.toThrow("原稿快照不能覆盖");
    expect(deps.map.get(INDEX)!.generation).toBe("1");
  });

  it("基线过期即冲突（不自动合并）；同一基线两路并发保存只成功一路", async () => {
    const deps = storage();
    const big = book("大书", 4, 9000);
    await writeLayoutLibrary(OWNER, lib([big, plain("甲")]), "0", deps, noMedia);
    const cloud = (await readLayoutLibrary(OWNER, deps, noMedia)).library!;
    const one = await buildLayoutSaveDelta(cloud, lib(cloud.documents.map((d, i) => i === 0 ? reviewOne(d, 0) : d)), "1", nodeDigest);
    const two = await buildLayoutSaveDelta(cloud, lib(cloud.documents.map((d, i) => i === 1 ? { ...d, title: "乙" } : d)), "1", nodeDigest);
    const results = await Promise.allSettled([writeLayoutLibraryDelta(OWNER, one, deps, noMedia), writeLayoutLibraryDelta(OWNER, two, deps, noMedia)]);
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    expect((results.find(r => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(LayoutConflict);
    await expect(writeLayoutLibraryDelta(OWNER, two, deps, noMedia)).rejects.toBeInstanceOf(LayoutConflict);
    expect(new LayoutConflict().message).toContain("云端排版稿已变化，未覆盖");
    // 云端不存在时以非 0 基线保存 = 冲突
    await expect(writeLayoutLibraryDelta(8, { ...two, expectedGeneration: "3" }, deps, noMedia)).rejects.toBeInstanceOf(LayoutConflict);
  });

  it("增量与云稿对不上：要求整库保存，前台自动退回整库且结果相同；服务端不认识新接口时本会话改用整库", async () => {
    const deps = storage();
    const big = book("大书", 3, 9000);
    await writeLayoutLibrary(OWNER, lib([big]), "0", deps, noMedia);
    const cloud = (await readLayoutLibrary(OWNER, deps, noMedia)).library!;
    const next = lib([reviewOne(cloud.documents[0], 0)]);
    const delta = await buildLayoutSaveDelta(cloud, next, "1", nodeDigest);
    await expect(writeLayoutLibraryDelta(OWNER, { ...delta, upserts: [{ ...delta.upserts[0], retainSource: { sha256: "c".repeat(64) } }] }, deps, noMedia)).rejects.toBeInstanceOf(LayoutDeltaNeedsFull);
    await expect(writeLayoutLibraryDelta(OWNER, { ...delta, order: [...delta.order, crypto.randomUUID()] }, deps, noMedia)).rejects.toBeInstanceOf(LayoutDeltaNeedsFull);
    expect(deps.map.get(INDEX)!.generation).toBe("1");
    const needsFull = Object.assign(new Error(new LayoutDeltaNeedsFull("x").message), { data: { code: "PRECONDITION_FAILED" } });
    const full = vi.fn(async (input: any) => writeLayoutLibrary(OWNER, input.library, input.expectedGeneration, deps, noMedia) as any);
    const out = await saveLayoutLibraryToCloud({ input: { library: next, expectedGeneration: "1" }, baseline: layoutCloudBaseline("1", cloud, "7"), deltaUnsupported: false, digest: nodeDigest, saveDelta: async () => { throw needsFull; }, saveFull: full });
    expect(out).toMatchObject({ mode: "full", unsupported: false });
    const oldServer = Object.assign(new Error("No procedure found"), { data: { code: "NOT_FOUND", httpStatus: 404 } });
    const out2 = await saveLayoutLibraryToCloud({ input: { library: next, expectedGeneration: "2" }, baseline: out.baseline, deltaUnsupported: false, digest: nodeDigest, saveDelta: async () => { throw oldServer; }, saveFull: full });
    expect(out2).toMatchObject({ mode: "full", unsupported: true });
    // 冲突、网络错误等不退回整库（不把已拒绝/未知结果变成再写一次）
    const conflict = Object.assign(new Error("云端排版稿已变化，未覆盖"), { data: { code: "CONFLICT" } });
    full.mockClear();
    await expect(saveLayoutLibraryToCloud({ input: { library: next, expectedGeneration: "3" }, baseline: out2.baseline, deltaUnsupported: false, digest: nodeDigest, saveDelta: async () => { throw conflict; }, saveFull: full })).rejects.toThrow("已变化");
    expect(full).not.toHaveBeenCalled();
    // 没有基线或基线版本不同：直接整库
    expect((await saveLayoutLibraryToCloud({ input: { library: next, expectedGeneration: "3" }, baseline: null, deltaUnsupported: false, digest: nodeDigest, saveDelta: async () => { throw new Error("不该调用"); }, saveFull: full })).mode).toBe("full");
  });

  it("前台就地改了页面上的稿对象，基线（私有拷贝）不受影响，改动照样上传", async () => {
    const deps = storage();
    await writeLayoutLibrary(OWNER, lib([plain("甲")]), "0", deps, noMedia);
    const read = await readLayoutLibrary(OWNER, deps, noMedia);
    const baseline = layoutCloudBaseline(read.generation, read.library, "7");
    read.library!.documents[0].title = "就地改";
    const delta = await buildLayoutSaveDelta(baseline.library, read.library!, "1", nodeDigest);
    expect(delta.upserts).toHaveLength(1);
  });
});

describe("上传体积（审校每完成一批的一次保存）", () => {
  it.each([[1], [6]])("%i 本 48 章大书的库", async books => {
    const docs = Array.from({ length: books }, (_, i) => book(`大书${i + 1}`, 48, 55_000));
    const deps = storage();
    await writeLayoutLibrary(OWNER, lib(docs), "0", deps, noMedia);
    const cloud = (await readLayoutLibrary(OWNER, deps, noMedia)).library!;
    // 已审校 20 章、正在存第 21 章
    let target = cloud.documents[0];
    for (let i = 0; i < 20; i++) target = reviewOne(target, i);
    const before = lib(cloud.documents.map((d, i) => i === 0 ? target : d));
    const saved = await writeLayoutLibrary(OWNER, before, "1", deps, noMedia);
    const base = (await readLayoutLibrary(OWNER, deps, noMedia)).library!;
    const next = lib(base.documents.map((d, i) => i === 0 ? reviewOne(d, 20) : d));
    const fullBytes = Buffer.byteLength(JSON.stringify({ library: next, expectedGeneration: saved.generation }));
    const delta = await buildLayoutSaveDelta(base, next, saved.generation, nodeDigest);
    const deltaBytes = Buffer.byteLength(JSON.stringify(delta));
    reset();
    let t = performance.now();
    await writeLayoutLibraryDelta(OWNER, JSON.parse(JSON.stringify(delta)), deps, noMedia);
    const deltaMs = performance.now() - t;
    console.info(`[delta] ${books}本48章：一次审校批次保存上传 改前 ${(fullBytes / 1048576).toFixed(2)}MB → 改后 ${(deltaBytes / 1024).toFixed(1)}KB；服务端(冷缓存)重建+写入 ${deltaMs.toFixed(0)}ms`);
    expect(deltaBytes).toBeLessThan(fullBytes / 25);
  }, 120_000);
});

describe("整库解析缓存", () => {
  it("同 generation 复用解析结果；读取方/写入方就地修改不串改；generation 变化即失效", async () => {
    const deps = storage();
    const input = lib([book("大书", 4, 9000), plain("甲")]);
    await writeLayoutLibrary(OWNER, input, "0", deps, noMedia);
    input.documents[1].title = "写入后改入参";
    deps.read.mockClear();
    const r1 = await readLayoutLibrary(OWNER, deps, noMedia);
    expect(deps.read).not.toHaveBeenCalled();
    expect(r1.library!.documents[1].title).toBe("甲");
    r1.library!.documents[1].title = "读后就地改";
    r1.library!.documents[0].publication!.source.pages[0].supplement = "篡改";
    r1.library!.documents.pop();
    const r2 = await readCanonicalLayoutLibrary(OWNER, deps);
    expect(r2.library!.documents).toHaveLength(2);
    expect(r2.library!.documents[1].title).toBe("甲");
    expect(r2.library!.documents[0].publication!.source.pages[0].supplement).toContain("图外内文");
    // 写入时填入的缓存与重新下载解析的结果逐字相同
    reset();
    const fresh = await readLayoutLibrary(OWNER, deps, noMedia);
    expect(JSON.stringify(fresh.library)).toBe(JSON.stringify(r2.library));
    expect(fresh.library).toEqual(r2.library);
    // 别处写入使 generation 变化：重新下载
    const env = JSON.parse(deps.map.get(INDEX)!.buffer.toString());
    env.library.documents[1].title = "别处改";
    deps.map.set(INDEX, { generation: "9", buffer: Buffer.from(JSON.stringify(env)) });
    deps.read.mockClear();
    expect((await readLayoutLibrary(OWNER, deps, noMedia)).library!.documents[1].title).toBe("别处改");
    expect(deps.read).toHaveBeenCalledTimes(1);
  });

  it("按字节 LRU 有上限：超额淘汰最旧的", () => {
    const Cache = (layoutParsedLibraryCache as any).constructor;
    const cache = new Cache(100);
    const entry = (g: string) => ({ library: lib([plain(g)]), updatedAt: "", externalRefs: [], generation: g, strict: true });
    cache.set("a", entry("1"), 40); cache.set("b", entry("2"), 40); cache.get("a"); cache.set("c", entry("3"), 40);
    expect(cache.get("b")).toBeUndefined();
    expect(cache.get("a")).toBeDefined();
    expect(cache.weight).toBeLessThanOrEqual(100);
    cache.set("huge", entry("4"), 101);
    expect(cache.get("huge")).toBeUndefined();
  });

  it.each([[48], [200]])("%i 章大书单次读取耗时：改前（每次下载+解析）vs 改后（同版本命中）", async chapters => {
    const deps = storage();
    const library = lib([book("大书", chapters, 55_000)]);
    await writeLayoutLibrary(OWNER, library, "0", { ...deps, inlineMaxBytes: Number.POSITIVE_INFINITY }, noMedia);
    const runs = 3;
    let cold = 0, warm = 0;
    for (let i = 0; i < runs; i++) {
      reset();
      let t = performance.now();
      await readCanonicalLayoutLibrary(OWNER, deps);
      cold += performance.now() - t;
      t = performance.now();
      const hit = await readCanonicalLayoutLibrary(OWNER, deps);
      warm += performance.now() - t;
      expect(hit.library!.documents[0].publication!.source.pages.length).toBe(chapters);
    }
    const bytes = deps.map.get(INDEX)!.buffer.length;
    console.info(`[parse] ${chapters}章（云稿 ${(bytes / 1048576).toFixed(1)}MB）单次读取：改前 ${(cold / runs).toFixed(0)}ms → 改后 ${(warm / runs).toFixed(1)}ms`);
    expect(warm).toBeLessThan(cold / 5);
  }, 120_000);

  it("v2（外置原文）库同样命中缓存，命中后不再读外置对象", async () => {
    const deps = storage();
    await writeLayoutLibrary(OWNER, lib([book("大书", 6, 9000)]), "0", { ...deps, inlineMaxBytes: 1024 }, noMedia);
    reset();
    await readCanonicalLayoutLibrary(OWNER, deps);
    deps.read.mockClear(); layoutExternalTextCache.clear();
    const again = await readCanonicalLayoutLibrary(OWNER, deps);
    expect(deps.read).not.toHaveBeenCalled();
    expect(again.library!.documents[0].publication!.source.pages[5].supplement).toContain("第6章图外内文");
    expect(cloneLayoutTree(again.library)).toEqual(again.library);
  });
});
