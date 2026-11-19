/**
 * 读页备料提速（2026-11-19）：目录页批量渲染 + 有界并发上传、顾问原文与文字断点后台化、挑页按组提前开扫。
 * 真实 poppler（pdftoppm / pdftotext）+ 真实 PDF 样张（130 页：含空白页、末页空白、表格两栏、行尾空格）。
 * 进程边界与上传处做失败注入；参照组按改动前的算法逐张 / 逐 48 页现算，逐字节比对。
 */
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const execHook = vi.hoisted(() => ({
  calls: [] as Array<{ command: string; args: string[] }>,
  before: undefined as undefined | ((command: string, args: string[]) => void | Promise<void>),
  transformStdout: undefined as undefined | ((command: string, args: string[], stdout: string) => string),
}));
vi.mock("./knowledgeCardCancellation.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./knowledgeCardCancellation.js")>();
  return {
    ...actual,
    execKnowledgeCardFile: async (command: string, args: string[], options: { maxBuffer: number; signal?: AbortSignal }) => {
      execHook.calls.push({ command, args });
      await execHook.before?.(command, args);
      const out = await actual.execKnowledgeCardFile(command, args, options);
      return execHook.transformStdout ? { ...out, stdout: execHook.transformStdout(command, args, out.stdout) } : out;
    },
  };
});

import {
  buildContactSheets,
  knowledgeCardSheetObjectName,
  prepareKnowledgeCardDocumentPages,
  splitPdfTextByPage,
  KNOWLEDGE_CARD_SHEET_CELLS,
  type KnowledgeCardPageSelector,
} from "./knowledgeCardDocumentPages";
import {
  __setKnowledgeCardDistillGatewayInvokerForTest,
  knowledgeCardResumablePageSelector,
  makeKnowledgeCardPageSelector,
  KNOWLEDGE_PAGE_SELECTION_CACHE_VERSION,
} from "./knowledgeCardDistill";
import { knowledgeStructuredDistillContext } from "./knowledgeCardStructuredDistill";
import { createHash } from "node:crypto";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK } from "../../shared/knowledgeCardDistillModels";

const run = promisify(execFile);
const FIXTURE = path.join(path.dirname(new URL(import.meta.url).pathname), "__fixtures__", "knowledge-pages-sample.pdf");
const USER = 7;
const DOC = "abcdef0123456789";
const PAGES = 130;
const SHEETS = Math.ceil(PAGES / KNOWLEDGE_CARD_SHEET_CELLS); // 11：两组挑页（8 + 3）

let pdf: Buffer;
let unhandled: unknown[] = [];
const onUnhandled = (reason: unknown) => { unhandled.push(reason); };

beforeEach(async () => {
  pdf ??= await fs.readFile(FIXTURE);
  execHook.calls = [];
  execHook.before = undefined;
  execHook.transformStdout = undefined;
  unhandled = [];
  process.on("unhandledRejection", onUnhandled);
  vi.stubEnv("OPENROUTER_API_KEY", "test-key");
  vi.stubEnv("EVOLINK_API_KEY", "test-key");
  vi.stubEnv("KNOWLEDGE_CARD_CHAIN_RETRY_DELAY_MS", "0");
});
afterEach(async () => {
  // 给后台 rejection 一个事件循环冒头的机会，再核对没有未处理的
  await new Promise((r) => setTimeout(r, 20));
  process.off("unhandledRejection", onUnhandled);
  expect(unhandled).toEqual([]);
  __setKnowledgeCardDistillGatewayInvokerForTest(null);
  vi.unstubAllEnvs();
});

function memoryStore(prefix = "knowledge-card-distill/user-7/resume") {
  const data = new Map<string, any>();
  const reads: string[] = [];
  const saves: string[] = [];
  return {
    data, reads, saves,
    store: {
      prefix,
      read: async (key: string) => { reads.push(key); return data.has(key) ? structuredClone(data.get(key)) : null; },
      save: async (key: string, value: unknown) => { saves.push(key); data.set(key, structuredClone(value)); },
    },
  };
}

/** GCS 替身：对象名 → 字节；可在第 N 次上传时注入失败或挂起 */
/** 只统计目录页（样张里的空白页另有读字图上传，与本改动无关） */
function fakeBucket() {
  const objects = new Map<string, Buffer>();
  let uploads = 0;
  const hooks: { fail?: (n: number, name: string) => boolean; gate?: (name: string) => Promise<void> | undefined } = {};
  return {
    objects, hooks,
    get uploads() { return uploads; },
    uploadPage: async (objectName: string, jpeg: Buffer) => {
      if (!objectName.includes("/sheets/")) return { gcsUri: `gs://test/${objectName}`, url: `https://signed.invalid/${objectName}` };
      uploads += 1;
      const n = uploads;
      await hooks.gate?.(objectName);
      if (hooks.fail?.(n, objectName)) throw new Error(`upload failed (test) ${objectName}`);
      objects.set(objectName, jpeg);
      return { gcsUri: `gs://test/${objectName}`, url: `https://signed.invalid/${objectName}` };
    },
    existingSheets: async () => new Map(Array.from(objects.keys()).filter((k) => k.includes("/sheets/")).map((k) => [k, { gcsUri: `gs://test/${k}`, url: `https://signed.invalid/${k}` }])),
  };
}

/** 改动前算法：每张目录页单独 pdftoppm（12 页）→ 拼图 */
async function referenceSheets(): Promise<Map<string, Buffer>> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-ref-"));
  await fs.writeFile(path.join(dir, "s.pdf"), pdf);
  const out = new Map<string, Buffer>();
  try {
    for (let index = 1; index <= SHEETS; index++) {
      const first = (index - 1) * KNOWLEDGE_CARD_SHEET_CELLS + 1, last = Math.min(PAGES, first + KNOWLEDGE_CARD_SHEET_CELLS - 1);
      const sub = await fs.mkdtemp(path.join(dir, "r"));
      await run("pdftoppm", ["-jpeg", "-jpegopt", "quality=78", "-scale-to-x", "360", "-scale-to-y", "-1", "-f", String(first), "-l", String(last), path.join(dir, "s.pdf"), path.join(sub, `t${first}`)]);
      const thumbs = new Map<number, Buffer>();
      for (const f of await fs.readdir(sub)) thumbs.set(Number(/-(\d+)\.jpg$/.exec(f)![1]), await fs.readFile(path.join(sub, f)));
      const [sheet] = await buildContactSheets(thumbs, index - 1);
      expect(sheet!.index).toBe(index);
      out.set(knowledgeCardSheetObjectName(USER, DOC, index), sheet!.jpeg);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  return out;
}

/** 改动前算法：每 48 页一次 pdftotext → 按 \f 分页 */
async function referenceTexts(source: Buffer = pdf, total = PAGES): Promise<{ pages: string[]; checkpoints: Map<string, string[]> }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-ref-"));
  await fs.writeFile(path.join(dir, "s.pdf"), source);
  const pages: string[] = [];
  const checkpoints = new Map<string, string[]>();
  try {
    for (let first = 1; first <= total; first += 48) {
      const last = Math.min(total, first + 47);
      const { stdout } = await run("pdftotext", ["-layout", "-enc", "UTF-8", "-f", String(first), "-l", String(last), path.join(dir, "s.pdf"), "-"], { maxBuffer: 1 << 28 });
      const split = splitPdfTextByPage(stdout);
      expect(split).toHaveLength(last - first + 1);
      checkpoints.set(`text/page-text-v1/${DOC}/${total}-${first}-${last}.json`, split);
      pages.push(...split);
    }
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
  return { pages, checkpoints };
}

const noSelect: KnowledgeCardPageSelector = async () => [];
const thumbCalls = () => execHook.calls.filter((c) => c.command === "pdftoppm" && c.args.includes("360"));
const textCalls = () => execHook.calls.filter((c) => c.command === "pdftotext");

describe("目录页：批量渲染、对象与内容不变", () => {
  it("每张目录页与改动前逐张渲染逐字节相同；对象名相同；一组挑页一次 pdftoppm；文字与断点逐字相同", async () => {
    const bucket = fakeBucket();
    const text = memoryStore("text");
    const progress: Array<[string, number, number]> = [];
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets, textCache: text.store,
      onProgress: (stage, done, total) => { progress.push([stage, done, total]); },
    });
    const ref = await referenceSheets();
    expect(Array.from(bucket.objects.keys()).sort()).toEqual(Array.from(ref.keys()).sort());
    for (const [name, jpeg] of ref) expect(bucket.objects.get(name)!.equals(jpeg), name).toBe(true);
    // 11 张目录页：第 1 组 8 张一次渲染（96 页），第 2 组 3 张一次渲染；以前是 11 次
    expect(thumbCalls().map((c) => [c.args[c.args.indexOf("-f") + 1], c.args[c.args.indexOf("-l") + 1]])).toEqual([["1", "96"], ["97", "130"]]);

    const refText = await referenceTexts();
    expect(set.pages.map((p) => p.text)).toEqual(refText.pages);
    expect(set.pages.map((p) => p.pageNumber)).toEqual(Array.from({ length: PAGES }, (_, i) => i + 1));
    expect(new Map(Array.from(text.data.entries()))).toEqual(refText.checkpoints);
    expect(refText.pages.filter((t) => !t).length).toBeGreaterThan(1); // 样张里确有空白页与空白末页
    // 进度：阶段不倒退、数值不倒退
    const thumbs = progress.filter((p) => p[0] === "thumbs").map((p) => p[1]);
    expect(thumbs).toEqual([...thumbs].sort((a, b) => a - b));
    expect(thumbs.at(-1)).toBe(PAGES);
    const stages = progress.map((p) => p[0]);
    expect(stages.lastIndexOf("text")).toBeLessThan(stages.indexOf("thumbs"));
    expect(stages.lastIndexOf("thumbs")).toBeLessThan(stages.indexOf("select"));
  }, 60_000);

  it("进度节流：节流窗口内只报起止，不逐张回报", async () => {
    const bucket = fakeBucket();
    const progress: Array<[string, number]> = [];
    await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage,
      progressThrottleMs: 60_000, onProgress: (stage, done) => { progress.push([stage, done]); },
    });
    expect(progress.filter((p) => p[0] === "thumbs")).toEqual([["thumbs", 0], ["thumbs", PAGES]]);
  }, 60_000);

  it("上传并行有上限（≤7），渲染不等逐张上传", async () => {
    const bucket = fakeBucket();
    // 上传全部挂住，直到 7 路同时在途（或 11 张都已开传）才一起放行：渲染若逐张等上传，这里会卡死超时
    let active = 0, peak = 0, started = 0;
    let held: Array<() => void> = [];
    bucket.hooks.gate = () => {
      active += 1; started += 1; peak = Math.max(peak, active);
      const wait = new Promise<void>((r) => held.push(() => { active -= 1; r(); }));
      if (active >= 7 || started === SHEETS) { const go = held; held = []; go.forEach((f) => f()); }
      return wait;
    };
    await prepareKnowledgeCardDocumentPages({ buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage });
    expect(peak).toBe(7);
    expect(bucket.objects.size).toBe(SHEETS);
  }, 60_000);
});

describe("目录页：失败注入与续做", () => {
  it("中途一张上传失败：整次备料报错（不报成功），已传的留着；续做只补缺的，结果与一次跑完逐字节相同", async () => {
    const bucket = fakeBucket();
    bucket.hooks.fail = (n) => n === 5;
    await expect(prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    })).rejects.toThrow("upload failed (test)");
    const afterCrash = new Set(bucket.objects.keys());
    expect(afterCrash.size).toBeGreaterThan(0);
    expect(afterCrash.size).toBeLessThan(SHEETS);

    bucket.hooks.fail = undefined;
    execHook.calls = [];
    const uploadsBefore = bucket.uploads;
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    });
    expect(set.pageCount).toBe(PAGES);
    expect(bucket.uploads - uploadsBefore).toBe(SHEETS - afterCrash.size);
    const ref = await referenceSheets();
    for (const [name, jpeg] of ref) expect(bucket.objects.get(name)!.equals(jpeg), name).toBe(true);
  }, 60_000);

  it("一批 pdftoppm 失败：报错、另一批已传的保留；续做只渲染失败那批", async () => {
    const bucket = fakeBucket();
    execHook.before = (command, args) => { if (command === "pdftoppm" && args.includes("360") && args[args.indexOf("-f") + 1] === "97") throw new Error("pdftoppm killed (test)"); };
    await expect(prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    })).rejects.toThrow("pdftoppm killed (test)");
    // 第 1 组 8 张已经传上去（渲染与失败批并行，失败不撤已完成的上传）
    expect(bucket.objects.size).toBe(8);

    execHook.before = undefined;
    execHook.calls = [];
    await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    });
    expect(thumbCalls().map((c) => c.args[c.args.indexOf("-f") + 1])).toEqual(["97"]);
    expect(bucket.objects.size).toBe(SHEETS);
  }, 60_000);

  it("崩溃后一半目录页已在：已在的一张都不重渲染、不重传；目录页内容与一次跑完相同", async () => {
    const ref = await referenceSheets();
    const bucket = fakeBucket();
    // 已有 1、3、4、5、9、10（含不连续的洞）
    for (const index of [1, 3, 4, 5, 9, 10]) bucket.objects.set(knowledgeCardSheetObjectName(USER, DOC, index), ref.get(knowledgeCardSheetObjectName(USER, DOC, index))!);
    const uploaded: string[] = [];
    const upload = async (name: string, jpeg: Buffer) => { if (name.includes("/sheets/")) uploaded.push(name); return bucket.uploadPage(name, jpeg); };
    const sheetsSeen: number[][] = [];
    await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER,
      selectPages: async (sheets) => { sheetsSeen.push(sheets.map((s) => s.index)); return []; },
      uploadPage: upload, existingSheets: bucket.existingSheets,
    });
    expect(uploaded.map((n) => Number(/s-(\d+)\.jpg$/.exec(n)![1])).sort((a, b) => a - b)).toEqual([2, 6, 7, 8, 11]);
    // 连续缺口合批：2 | 6–8 | 11
    expect(thumbCalls().map((c) => [c.args[c.args.indexOf("-f") + 1], c.args[c.args.indexOf("-l") + 1]]).sort()).toEqual([["121", "130"], ["13", "24"], ["61", "96"]].sort());
    for (const [name, jpeg] of ref) expect(bucket.objects.get(name)!.equals(jpeg), name).toBe(true);
    expect(sheetsSeen).toEqual([Array.from({ length: SHEETS }, (_, i) => i + 1)]);
  }, 60_000);
});

describe("顾问原文与文字断点：后台执行，末尾统一收口", () => {
  it("顾问原文写入不挡目录页：它挂起时目录页照常全部传完；它最后失败 → 整次备料报错，无未处理 rejection", async () => {
    const bucket = fakeBucket();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let sheetsWhileTextPending = 0;
    const onTextReady = vi.fn(async () => { await gate; throw new Error("advisor write failed (test)"); });
    const done = prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: async () => { sheetsWhileTextPending = bucket.objects.size; release(); return []; },
      uploadPage: bucket.uploadPage, onTextReady,
    });
    await expect(done).rejects.toThrow("advisor write failed (test)");
    expect(onTextReady).toHaveBeenCalledTimes(1);
    expect(sheetsWhileTextPending).toBe(SHEETS);
  }, 60_000);

  it("主流程先失败时也等后台原文写完再抛主错误；后台的错误不变成未处理 rejection", async () => {
    const bucket = fakeBucket();
    bucket.hooks.fail = () => true;
    let finished = false;
    const onTextReady = async () => { await new Promise((r) => setTimeout(r, 50)); finished = true; throw new Error("advisor also failed (test)"); };
    await expect(prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage, onTextReady,
    })).rejects.toThrow("upload failed (test)");
    expect(finished).toBe(true);
  }, 60_000);

  it("文字断点写失败只告警（与以前相同），不挡备料；断点后台写完才返回", async () => {
    const bucket = fakeBucket();
    const text = memoryStore("text");
    let saving = 0;
    const store = { ...text.store, save: async (key: string, value: unknown) => { saving += 1; await new Promise((r) => setTimeout(r, 40)); if (key.endsWith("-49-96.json")) throw new Error("ENOSPC (test)"); await text.store.save(key, value); saving -= 1; } };
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const set = await prepareKnowledgeCardDocumentPages({ buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage, textCache: store });
      expect(set.pages).toHaveLength(PAGES);
      expect(saving).toBe(1); // 只剩失败那一组没减回去：其余组都在返回前写完
      expect(Array.from(text.data.keys()).sort()).toEqual([`text/page-text-v1/${DOC}/${PAGES}-1-48.json`, `text/page-text-v1/${DOC}/${PAGES}-97-130.json`]);
      expect(warn.mock.calls.some((c) => String(c[0]).includes("文字断点保存失败"))).toBe(true);
    } finally { warn.mockRestore(); }
  }, 60_000);

  it("断点缺一组：只抽缺的那段；整段分页数对不上时退回逐组抽取，文字仍与以前逐字相同", async () => {
    const ref = await referenceTexts();
    const bucket = fakeBucket();
    const text = memoryStore("text");
    for (const [k, v] of ref.checkpoints) if (!k.endsWith("-49-96.json")) text.data.set(k, v);
    const set = await prepareKnowledgeCardDocumentPages({ buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage, textCache: text.store });
    expect(textCalls().map((c) => [c.args[c.args.indexOf("-f") + 1], c.args[c.args.indexOf("-l") + 1]])).toEqual([["49", "96"]]);
    expect(set.pages.map((p) => p.text)).toEqual(ref.pages);
    expect(text.saves).toEqual([`text/page-text-v1/${DOC}/${PAGES}-49-96.json`]);

  }, 60_000);

  it("大书多组：缺失组合并成至多 4 段并行抽取，逐页文字与以前逐 48 页抽取逐字相同；整段分页数对不上时退回逐组", async () => {
    // 三本样张拼成 390 页（9 组断点）：真实 PDF，跨组整段抽取
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kc-big-"));
    try {
      await fs.writeFile(path.join(dir, "a.pdf"), pdf);
      await run("pdfunite", [path.join(dir, "a.pdf"), path.join(dir, "a.pdf"), path.join(dir, "a.pdf"), path.join(dir, "big.pdf")]);
      const big = await fs.readFile(path.join(dir, "big.pdf"));
      const total = PAGES * 3;
      const ref = await referenceTexts(big, total);
      const bucket = fakeBucket();
      const text = memoryStore("text");
      let inFlight = 0, peak = 0;
      execHook.before = async (command) => { if (command === "pdftotext") { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((r) => setTimeout(r, 30)); inFlight -= 1; } };
      const set = await prepareKnowledgeCardDocumentPages({ buffer: big, docKey: DOC, fileName: "big.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage, textCache: text.store });
      expect(set.pages.map((p) => p.text)).toEqual(ref.pages);
      expect(new Map(text.data)).toEqual(ref.checkpoints);
      expect(textCalls().map((c) => [c.args[c.args.indexOf("-f") + 1], c.args[c.args.indexOf("-l") + 1]]).sort()).toEqual([["1", "144"], ["145", "288"], ["289", "390"]].sort());
      expect(peak).toBe(3);

      // 注入：跨组整段输出少一个分页符 → 该段退回逐组抽取，文字与断点仍逐字相同
      execHook.calls = [];
      execHook.before = undefined;
      execHook.transformStdout = (command, args, stdout) => {
        const f = Number(args[args.indexOf("-f") + 1]), l = Number(args[args.indexOf("-l") + 1]);
        return command === "pdftotext" && l - f + 1 > 48 ? stdout.replace("\f", "") : stdout;
      };
      const fresh = memoryStore("text");
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        const again = await prepareKnowledgeCardDocumentPages({ buffer: big, docKey: DOC, fileName: "big.pdf", userId: USER, selectPages: noSelect, uploadPage: bucket.uploadPage, textCache: fresh.store });
        expect(again.pages.map((p) => p.text)).toEqual(ref.pages);
        expect(warn.mock.calls.some((c) => String(c[0]).includes("退回逐组抽取"))).toBe(true);
      } finally { warn.mockRestore(); }
      expect(new Map(fresh.data)).toEqual(ref.checkpoints);
      expect(textCalls()).toHaveLength(3 + 9);
    } finally { await fs.rm(dir, { recursive: true, force: true }); }
  }, 120_000);

  it("旧书（断点与目录页全在）：零 pdftotext、零缩略图渲染、零上传、零断点重写", async () => {
    const ref = await referenceTexts();
    const sheets = await referenceSheets();
    const bucket = fakeBucket();
    for (const [k, v] of sheets) bucket.objects.set(k, v);
    const text = memoryStore("text");
    for (const [k, v] of ref.checkpoints) text.data.set(k, v);
    const uploadsBefore = bucket.uploads;
    let streamed = false;
    const selector = Object.assign(async () => [], { stream: () => { streamed = true; throw new Error("不该流式"); } }) as KnowledgeCardPageSelector;
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: selector,
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets, textCache: text.store,
    });
    expect(set.pages.map((p) => p.text)).toEqual(ref.pages);
    expect(textCalls()).toEqual([]);
    expect(thumbCalls()).toEqual([]);
    expect(bucket.uploads).toBe(uploadsBefore);
    expect(text.saves).toEqual([]);
    expect(streamed).toBe(false);
  }, 60_000);
});

const triageAnswer = (p: { imageUrls?: string[] }) => {
  const first = Number(/s-(\d+)\.jpg/.exec(p.imageUrls![0]!)![1]);
  return JSON.stringify({ pages: [{ page: (first - 1) * KNOWLEDGE_CARD_SHEET_CELLS + 2, reason: "表格" }] });
};

describe("挑页：按组提前开扫、按组缓存、旧整本缓存只读", () => {
  it("第 1 组 8 张一就绪就开扫：第 2 组目录页还卡在上传时第 1 组已在途", async () => {
    const bucket = fakeBucket();
    let releaseUpload!: () => void;
    const uploadGate = new Promise<void>((r) => { releaseUpload = r; });
    bucket.hooks.gate = (name) => Number(/s-(\d+)\.jpg$/.exec(name)![1]) > 8 ? uploadGate : undefined;
    const calls: any[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p: any) => {
      calls.push({ p, uploadedAtCall: bucket.objects.size });
      if (calls.length === 1) releaseUpload();
      return triageAnswer(p);
    });
    const set = await prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: makeKnowledgeCardPageSelector("glm-5.3-flashx"),
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    });
    expect(calls).toHaveLength(2);
    expect(calls[0].uploadedAtCall).toBe(8);
    expect(calls[0].p.imageUrls).toHaveLength(8);
    // 结果按组序归位，与整本一次扫读同序
    expect(set.selectedPages).toEqual([2, 98]);
    // 回落链：GLM 本组首选通道起跳（第 1 组 OpenRouter，第 2 组 EvoLink）
    expect(calls.map((c) => `${c.p.gateway}:${c.p.tier}`).sort()).toEqual(["evolink:glm", "openrouter:glm"]);
  }, 60_000);

  it("选 DeepSeek 档也先走 GLM 两家再 DeepSeek（共同硬规矩第 3 条）；不设 180 秒总时长", async () => {
    const hops: string[] = [];
    const timeouts: Array<number | undefined> = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p: any) => { hops.push(`${p.gateway}:${p.tier}`); timeouts.push(p.timeoutMs); if (p.tier === "glm") throw new Error("HTTP 503 test"); return '{"pages":[]}'; });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      await makeKnowledgeCardPageSelector(KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK)([{ index: 1, pageNumbers: [1], imageUrl: "https://x.invalid/s-001.jpg", gcsUri: "gs://t/s-001.jpg" }], 1);
    } finally { warn.mockRestore(); }
    expect(hops).toEqual(["openrouter:glm", "evolink:glm", "openrouter:deepseek"]);
    expect(timeouts.every((t) => (t ?? 0) > 180_000)).toBe(true);
  });

  it("按组缓存：一组失败 → 只落成功组、回报残缺；再跑只重扫失败组；全部成功后零调用", async () => {
    const bucket = fakeBucket();
    const resume = memoryStore();
    const evidence = memoryStore("knowledge-card-distill/user-7/job-a");
    let failGroup2 = true;
    const calls: number[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p: any) => {
      const first = Number(/s-(\d+)\.jpg/.exec(p.imageUrls[0])![1]);
      calls.push(first);
      if (first === 9 && failGroup2) throw new Error("HTTP 401 test");
      return triageAnswer(p);
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const prepare = async () => {
      let incomplete = false;
      const set = await knowledgeStructuredDistillContext.run({ evidence: evidence.store, resume: resume.store } as any, () => prepareKnowledgeCardDocumentPages({
        buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: knowledgeCardResumablePageSelector("glm-5.3-flashx", undefined, () => { incomplete = true; }),
        uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
      }));
      return { set, incomplete };
    };
    try {
      const first = await prepare();
      expect(first.incomplete).toBe(true);
      expect(first.set.selectedPages).toEqual([2]);
      const groupKeys = () => Array.from(resume.data.keys()).filter((k) => k.includes("/page-selection/"));
      expect(groupKeys()).toHaveLength(1);
      expect(resume.data.get(groupKeys()[0]!).identity.version).toBe(KNOWLEDGE_PAGE_SELECTION_CACHE_VERSION);
      // 401 是确定性失败：本组不换跳，直接判本组失败
      expect([...calls].sort((a, b) => a - b)).toEqual([1, 9]);

      failGroup2 = false;
      calls.length = 0;
      const second = await prepare();
      expect(calls).toEqual([9]);
      expect(second.incomplete).toBe(false);
      expect(second.set.selectedPages).toEqual([2, 98]);
      expect(groupKeys()).toHaveLength(2);

      calls.length = 0;
      const third = await prepare();
      expect(calls).toEqual([]);
      expect(third.set.selectedPages).toEqual([2, 98]);
    } finally { warn.mockRestore(); }
  }, 120_000);

  it("v1 整本挑页缓存只读命中：已扫完的旧书零调用、不写 v2，参考页不变", async () => {
    const sheets = await referenceSheets();
    const bucket = fakeBucket();
    for (const [k, v] of sheets) bucket.objects.set(k, v);
    const resume = memoryStore();
    const identity = { version: "page-selection-v1", model: "glm-5.3-flashx", pageCount: PAGES, sheets: Array.from({ length: SHEETS }, (_, i) => {
      const first = i * 12 + 1;
      return { gcsUri: `gs://test/${knowledgeCardSheetObjectName(USER, DOC, i + 1)}`, pageNumbers: Array.from({ length: Math.min(PAGES, first + 11) - first + 1 }, (_, k) => first + k) };
    }) };
    const key = `${resume.store.prefix}/page-selection/${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.json`;
    resume.data.set(key, { identity, pages: [{ pageNumber: 55, reason: "旧书已选" }] });
    const hook = vi.fn(async () => '{"pages":[]}');
    __setKnowledgeCardDistillGatewayInvokerForTest(hook as any);
    const set = await knowledgeStructuredDistillContext.run({ evidence: memoryStore("e").store, resume: resume.store } as any, () => prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: knowledgeCardResumablePageSelector("glm-5.3-flashx"),
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    }));
    expect(hook).not.toHaveBeenCalled();
    expect(set.selectedPages).toEqual([55]);
    expect(resume.saves).toEqual([]);
  }, 60_000);

  it("目录页失败时：缺页的组不派发，已凑齐的组收尾并照常落缓存，整次备料报目录页的错", async () => {
    const bucket = fakeBucket();
    bucket.hooks.fail = (_n, name) => Number(/s-(\d+)\.jpg$/.exec(name)![1]) === 10;
    const resume = memoryStore();
    const calls: number[] = [];
    __setKnowledgeCardDistillGatewayInvokerForTest(async (p: any) => { calls.push(Number(/s-(\d+)\.jpg/.exec(p.imageUrls[0])![1])); await new Promise((r) => setTimeout(r, 30)); return triageAnswer(p); });
    await expect(knowledgeStructuredDistillContext.run({ evidence: memoryStore("e").store, resume: resume.store } as any, () => prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: knowledgeCardResumablePageSelector("glm-5.3-flashx"),
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
    }))).rejects.toThrow("upload failed (test)");
    expect(calls).toEqual([1]);
    expect(Array.from(resume.data.keys()).filter((k) => k.includes("/page-selection/"))).toHaveLength(1);
  }, 60_000);

  it("挑页安全拒绝 / 取消照样整体报错，不被「本组不选参考页」吞掉；渲染端随之收口", async () => {
    const bucket = fakeBucket();
    const abort = new AbortController();
    __setKnowledgeCardDistillGatewayInvokerForTest(async () => { abort.abort(new Error("用户已停止读档（test）")); throw new Error("用户已停止读档（test）"); });
    await expect(prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, abortSignal: abort.signal, selectPages: makeKnowledgeCardPageSelector("glm-5.3-flashx", abort.signal),
      uploadPage: bucket.uploadPage,
    })).rejects.toThrow(/停止读档|aborted/);
  }, 60_000);
});

describe("审查回归（2026-11-19）", () => {
  it("目录图列表暂时不可读 + v1 整本挑页缓存在：不流式重扫，零模型调用，参考页取 v1", async () => {
    const sheets = await referenceSheets();
    const bucket = fakeBucket();
    for (const [k, v] of sheets) bucket.objects.set(k, v);
    const resume = memoryStore();
    const identity = { version: "page-selection-v1", model: "glm-5.3-flashx", pageCount: PAGES, sheets: Array.from({ length: SHEETS }, (_, i) => {
      const first = i * 12 + 1;
      return { gcsUri: `gs://test/${knowledgeCardSheetObjectName(USER, DOC, i + 1)}`, pageNumbers: Array.from({ length: Math.min(PAGES, first + 11) - first + 1 }, (_, k) => first + k) };
    }) };
    const key = `${resume.store.prefix}/page-selection/${createHash("sha256").update(JSON.stringify(identity)).digest("hex")}.json`;
    resume.data.set(key, { identity, pages: [{ pageNumber: 55, reason: "旧书已选" }] });
    const hook = vi.fn(async () => '{"pages":[]}');
    __setKnowledgeCardDistillGatewayInvokerForTest(hook as any);
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const set = await knowledgeStructuredDistillContext.run({ evidence: memoryStore("e").store, resume: resume.store } as any, () => prepareKnowledgeCardDocumentPages({
        buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: knowledgeCardResumablePageSelector("glm-5.3-flashx"),
        uploadPage: bucket.uploadPage, existingSheets: async () => { throw new Error("list 503 (test)"); },
      }));
      expect(hook).not.toHaveBeenCalled();
      expect(set.selectedPages).toEqual([55]);
      expect(resume.saves).toEqual([]);
    } finally { warn.mockRestore(); }
  }, 60_000);

  it("顾问原文写入先失败（如原读档内容已改变）：不再继续渲染目录页、不再派发挑页（不白付模型费），报原文写入的错", async () => {
    const bucket = fakeBucket();
    const hook = vi.fn(async (p: any) => triageAnswer(p));
    __setKnowledgeCardDistillGatewayInvokerForTest(hook as any);
    await expect(prepareKnowledgeCardDocumentPages({
      buffer: pdf, docKey: DOC, fileName: "s.pdf", userId: USER, selectPages: makeKnowledgeCardPageSelector("glm-5.3-flashx"),
      uploadPage: bucket.uploadPage, existingSheets: bucket.existingSheets,
      onTextReady: async () => { throw new Error("原读档内容已改变，禁止重复购买（test）"); },
    })).rejects.toThrow("原读档内容已改变");
    expect(hook).not.toHaveBeenCalled();
    expect(bucket.uploads).toBe(0);
  }, 60_000);
});
