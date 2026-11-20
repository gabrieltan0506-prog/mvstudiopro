/**
 * 大书 / 多本大书的云稿存储（1121 夜）：数据一律经正式 schema（layoutFromSource → editableLayoutSchema、layoutLibrarySchema）生成，
 * 结构与线上大书一致：48 章、每章正文约 200 字 + 图外内文约 5.5 万字、detailLevel=full、readingContract=image-primary-v1、
 * reviewBatchMode=ready-images、每页 role=illustration 且有 imageJobId。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { performance } from "node:perf_hooks";
import { layoutFromSource, layoutLibrarySchema, type LayoutLibrary } from "../../shared/editableLayout";
import { knowledgeReviewBatches } from "../../shared/knowledgePublication";
import { knowledgeSourceDigest } from "./knowledgePublicationAdvisor";
import { LayoutConflict, layoutExternalTextCache, layoutLibraryBufferCache, readCanonicalLayoutLibrary, readLayoutLibrary, writeLayoutLibrary } from "./editableLayoutStore";
import { EXTERNAL_TEXT_MIN_CHARS } from "./editableLayoutExternalText";

const OWNER = 7;
const noMedia = { normalize: async () => undefined, sign: (s: string) => s } as any;
const filler = "资治通鉴卷一周纪一威烈王二十三年初命晋大夫魏斯赵籍韩虔为诸侯臣光曰臣闻天子之职莫大于礼礼莫大于分分莫大于名何谓礼纪纲是也何谓分君臣是也何谓名公侯卿大夫是也。";

function book(tag: string, chapters: number, supplementChars: number) {
  const pages = Array.from({ length: chapters }, (_, i) => {
    const head = `【${tag}·第${i + 1}章图外内文】`;
    return {
      headline: `${tag} 第${i + 1}章`,
      body: `${tag}第${i + 1}章正文：` + filler.repeat(3).slice(0, 200),
      pageIndex: i + 1,
      imageJobId: `job_${tag}_${i + 1}`,
      knowledgeRole: "illustration" as const,
      supplement: (head + filler.repeat(Math.ceil(supplementChars / filler.length))).slice(0, supplementChars),
    };
  });
  const doc = layoutFromSource({
    kind: "knowledge-publication", owner: String(OWNER), sourceId: `src-${tag}`, title: `${tag}（完整版）`, body: "",
    detailLevel: "full", readingContract: "image-primary-v1", reviewBatchMode: "ready-images",
    inputFingerprint: "a".repeat(64), pages,
  });
  return doc;
}
const libraryOf = (docs: ReturnType<typeof book>[]): LayoutLibrary => layoutLibrarySchema.parse({ version: 1, owner: String(OWNER), documents: docs });

function storage() {
  const map = new Map<string, { buffer: Buffer; generation: string }>();
  const uploads: { objectName: string; bytes: number }[] = [];
  const deps = {
    uploads,
    map,
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
  return deps;
}
const indexName = `editable-layouts/user-${OWNER}/library.json`;
const envelopeOf = (deps: ReturnType<typeof storage>) => JSON.parse(deps.map.get(indexName)!.buffer.toString("utf8"));
const reset = () => { layoutExternalTextCache.clear(); layoutLibraryBufferCache.clear?.(); };

beforeEach(() => { vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-21T03:00:00.000Z")); reset(); });
afterEach(() => { vi.useRealTimers(); reset(); });

describe("小库与没有大书的库：写出逐字节不变（v1）", () => {
  it.each([
    ["4 章短内文", [book("小书", 4, 800)]],
    ["4 章、每章 5.5 万字（库远小于外置门槛）", [book("小大书", 4, 55_000)]],
  ])("%s", async (_name, docs) => {
    const deps = storage();
    const library = libraryOf(docs);
    await writeLayoutLibrary(OWNER, library, "0", deps as any, noMedia);
    // 期望值 = 改动前的序列化表达式原样。
    const expected = Buffer.from(JSON.stringify({ format: "editable-layout-v1", owner: OWNER, updatedAt: "2026-11-21T03:00:00.000Z", library }));
    expect(deps.map.get(indexName)!.buffer.equals(expected)).toBe(true);
    expect(deps.uploads).toHaveLength(1);
    expect((await readLayoutLibrary(OWNER, deps as any, noMedia)).library).toEqual(library);
  });
});

describe("大书与多本大书：外置图外内文（v2）", () => {
  it("1 本 48 章 + 5 本同规模：保存、读回逐字相同；原稿摘要与分批不变；再次保存只传小索引", async () => {
    const docs = Array.from({ length: 6 }, (_, b) => book(`大书${b + 1}`, 48, 55_000));
    const library = libraryOf(docs);
    const v1Bytes = Buffer.byteLength(JSON.stringify({ format: "editable-layout-v1", owner: OWNER, updatedAt: "2026-11-21T03:00:00.000Z", library }));

    // 改前行为（全文内联、从不外置）：inlineMaxBytes=∞ 即与旧代码同一路径。
    const before = storage();
    let t = performance.now();
    await writeLayoutLibrary(OWNER, library, "0", { ...before, inlineMaxBytes: Number.POSITIVE_INFINITY } as any, noMedia);
    const edited = { ...library, documents: library.documents.map((d, i) => i === 0 ? { ...d, title: d.title + "·改", updatedAt: "2026-11-21T03:00:01.000Z" } : d) };
    before.uploads.length = 0; t = performance.now();
    await writeLayoutLibrary(OWNER, edited, "1", { ...before, inlineMaxBytes: Number.POSITIVE_INFINITY } as any, noMedia);
    const beforeMs = performance.now() - t, beforeUpload = before.uploads.reduce((s, u) => s + u.bytes, 0);

    // 默认门槛是保守档 48MB（6 本共约 46MB 不会触发）；这里显式用 16MB 档验证外置路径。
    const after = Object.assign(storage(), { inlineMaxBytes: 16 * 1024 * 1024 });
    t = performance.now();
    await writeLayoutLibrary(OWNER, library, "0", after as any, noMedia);
    const firstMs = performance.now() - t, firstUpload = after.uploads.reduce((s, u) => s + u.bytes, 0);
    const env = envelopeOf(after);
    expect(env.format).toBe("editable-layout-v2");
    expect(env.externalText.refs).toHaveLength(6 * 48);
    expect(after.uploads.filter(u => u.objectName.includes("/text/sha256-"))).toHaveLength(6 * 48);
    // 外置对象先于索引写入。
    expect(after.uploads.at(-1)!.objectName).toBe(indexName);

    reset();
    const read = await readLayoutLibrary(OWNER, after as any, noMedia);
    expect(JSON.stringify(read.library)).toBe(JSON.stringify(library));
    const canonical = await readCanonicalLayoutLibrary(OWNER, after as any);
    for (const [i, doc] of canonical.library!.documents.entries()) {
      expect(knowledgeSourceDigest(doc.publication!.source)).toBe(knowledgeSourceDigest(library.documents[i].publication!.source));
      expect(knowledgeReviewBatches(doc.publication!.source)).toEqual(knowledgeReviewBatches(library.documents[i].publication!.source));
      expect(doc.publication!.inputFingerprint).toBe(library.documents[i].publication!.inputFingerprint);
      expect(doc.publication!.requestId).toBe(library.documents[i].publication!.requestId);
    }

    after.uploads.length = 0; after.read.mockClear(); reset();
    t = performance.now();
    await writeLayoutLibrary(OWNER, edited, "1", after as any, noMedia);
    const afterMs = performance.now() - t, afterUpload = after.uploads.reduce((s, u) => s + u.bytes, 0);
    // 再次保存：外置原文未变 → 不重传、写前核对也不下载外置对象（由本次完整库按摘要还原）。
    expect(after.uploads.map(u => u.objectName)).toEqual([indexName]);
    expect(after.read.mock.calls.filter(c => String((c[0] as any).gcsUri).includes("/text/"))).toHaveLength(0);
    expect(afterUpload).toBeLessThan(beforeUpload / 10);
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, after as any, noMedia)).library)).toBe(JSON.stringify(edited));

    console.info(`[scale] 6×48章：v1整库 ${(v1Bytes / 1048576).toFixed(1)}MB；v2索引 ${(after.map.get(indexName)!.buffer.length / 1048576).toFixed(2)}MB；` +
      `再次保存上传 改前 ${(beforeUpload / 1048576).toFixed(1)}MB/${beforeMs.toFixed(0)}ms → 改后 ${(afterUpload / 1048576).toFixed(2)}MB/${afterMs.toFixed(0)}ms；首存(含外置) ${(firstUpload / 1048576).toFixed(1)}MB/${firstMs.toFixed(0)}ms`);
  }, 120_000);

  it("改前会被 64MB 上限拒绝的库（200 章 + 5 本 48 章）改后能存能读", async () => {
    const library = libraryOf([book("巨册", 200, 55_000), ...Array.from({ length: 5 }, (_, b) => book(`大书${b + 1}`, 48, 55_000))]);
    const old = storage();
    await expect(writeLayoutLibrary(OWNER, library, "0", { ...old, inlineMaxBytes: Number.POSITIVE_INFINITY } as any, noMedia)).rejects.toThrow("超过64MB");
    expect(old.uploads).toHaveLength(0);
    const deps = storage();
    await writeLayoutLibrary(OWNER, library, "0", deps as any, noMedia);
    console.info(`[scale] 200章+5×48章：v2索引 ${(deps.map.get(indexName)!.buffer.length / 1048576).toFixed(2)}MB，外置对象 ${deps.uploads.length - 1} 个`);
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, deps as any, noMedia)).library)).toBe(JSON.stringify(library));
  }, 120_000);

  it("并发冲突仍被拒：旧 generation 不能覆盖，外置对象写成也不改索引", async () => {
    const deps = storage();
    const library = libraryOf([book("大书", 48, 55_000)]);
    await writeLayoutLibrary(OWNER, library, "0", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    const a = { ...library, documents: library.documents.map(d => ({ ...d, title: "A", updatedAt: "2026-11-21T03:00:02.000Z" })) };
    const b = { ...library, documents: library.documents.map(d => ({ ...d, title: "B", updatedAt: "2026-11-21T03:00:03.000Z" })) };
    await writeLayoutLibrary(OWNER, a, "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    const index = deps.map.get(indexName)!.buffer;
    await expect(writeLayoutLibrary(OWNER, b, "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia)).rejects.toBeInstanceOf(LayoutConflict);
    expect(deps.map.get(indexName)!.buffer).toBe(index);
    // 读取时 generation 与内容一致
    const read = await readLayoutLibrary(OWNER, deps as any, noMedia);
    expect(read.generation).toBe("2");
    expect(read.library!.documents[0].title).toBe("A");
  }, 60_000);

  it("外置对象缺失或内容不符：读取与保存都报明确错误，不当作空文本、不覆盖", async () => {
    const deps = storage();
    const keep = book("保留", 4, EXTERNAL_TEXT_MIN_CHARS + 10), gone = book("将删", 4, EXTERNAL_TEXT_MIN_CHARS + 20);
    const library = libraryOf([keep, gone]);
    await writeLayoutLibrary(OWNER, library, "0", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    const textNames = Array.from(deps.map.keys()).filter(k => k.includes("/text/"));
    expect(textNames).toHaveLength(8);
    const goneName = textNames.find(n => deps.map.get(n)!.buffer.toString("utf8").includes("将删"))!;
    const saved = deps.map.get(goneName)!;
    deps.map.delete(goneName);
    reset();
    await expect(readLayoutLibrary(OWNER, deps as any, noMedia)).rejects.toThrow("缺少外置原文");
    // 新库删掉了这本书：写前核对仍需还原旧版，缺失对象 → 拒绝保存，索引不变。
    const indexBefore = deps.map.get(indexName)!.buffer;
    await expect(writeLayoutLibrary(OWNER, libraryOf([keep]), "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia)).rejects.toThrow("缺少外置原文");
    expect(deps.map.get(indexName)!.buffer).toBe(indexBefore);
    // 内容被篡改
    deps.map.set(goneName, { ...saved, buffer: Buffer.from(JSON.stringify("被改过的内容")) });
    reset();
    await expect(readLayoutLibrary(OWNER, deps as any, noMedia)).rejects.toThrow("校验不符");
    // 恢复对象后一切照常
    deps.map.set(goneName, saved);
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, deps as any, noMedia)).library)).toBe(JSON.stringify(library));
  });

  it("外置对象写入中途失败：索引不写，旧稿原样可读", async () => {
    const deps = storage();
    const first = libraryOf([book("甲", 4, EXTERNAL_TEXT_MIN_CHARS + 1)]);
    await writeLayoutLibrary(OWNER, first, "0", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    const second = libraryOf([...first.documents, book("乙", 4, EXTERNAL_TEXT_MIN_CHARS + 2)]);
    const realWrite = deps.write.getMockImplementation()!;
    let n = 0;
    deps.write.mockImplementation(async (i: any) => { if (i.objectName.includes("/text/") && ++n === 2) throw new Error("gcs_upload_failed:503:{}"); return realWrite(i); });
    await expect(writeLayoutLibrary(OWNER, second, "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia)).rejects.toThrow("503");
    expect(deps.map.get(indexName)!.generation).toBe("1");
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, deps as any, noMedia)).library)).toBe(JSON.stringify(first));
    // 重试：已写成的对象（412）视为已存在，索引写入成功。
    deps.write.mockImplementation(realWrite);
    await writeLayoutLibrary(OWNER, second, "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, deps as any, noMedia)).library)).toBe(JSON.stringify(second));
  });

  it("旧 v1 大库原样可读；下一次保存才转 v2，内容逐字不变；库缩小后回到 v1", async () => {
    const deps = storage();
    const library = libraryOf([book("旧大书", 6, EXTERNAL_TEXT_MIN_CHARS + 5)]);
    await writeLayoutLibrary(OWNER, library, "0", deps as any, noMedia);
    expect(envelopeOf(deps).format).toBe("editable-layout-v1");
    await writeLayoutLibrary(OWNER, library, "1", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    expect(envelopeOf(deps).format).toBe("editable-layout-v2");
    reset();
    expect(JSON.stringify((await readLayoutLibrary(OWNER, deps as any, noMedia)).library)).toBe(JSON.stringify(library));
    await writeLayoutLibrary(OWNER, library, "2", deps as any, noMedia);
    const expected = Buffer.from(JSON.stringify({ format: "editable-layout-v1", owner: OWNER, updatedAt: "2026-11-21T03:00:00.000Z", library }));
    expect(deps.map.get(indexName)!.buffer.equals(expected)).toBe(true);
  });

  it("含孤立代理字符等特殊码元的内文外置后逐码元还原", async () => {
    const deps = storage();
    const doc = book("码元", 2, EXTERNAL_TEXT_MIN_CHARS + 3);
    doc.publication!.source.pages[0].supplement = "\ud800孤立" + doc.publication!.source.pages[0].supplement + "\udfff\u0000\u2028";
    const library = libraryOf([doc]);
    await writeLayoutLibrary(OWNER, library, "0", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    expect(envelopeOf(deps).format).toBe("editable-layout-v2");
    reset();
    const read = await readLayoutLibrary(OWNER, deps as any, noMedia);
    expect(read.library!.documents[0].publication!.source.pages[0].supplement).toBe(library.documents[0].publication!.source.pages[0].supplement);
  });
  it("v2 信封账号不符照旧拒读", async () => {
    const deps = storage();
    await writeLayoutLibrary(OWNER, libraryOf([book("甲", 2, EXTERNAL_TEXT_MIN_CHARS)]), "0", { ...deps, inlineMaxBytes: 1024 } as any, noMedia);
    const env = envelopeOf(deps);
    deps.map.set(indexName, { generation: "1", buffer: Buffer.from(JSON.stringify({ ...env, owner: 8 })) });
    reset();
    await expect(readLayoutLibrary(OWNER, deps as any, noMedia)).rejects.toThrow("身份无法校验");
  });
});
