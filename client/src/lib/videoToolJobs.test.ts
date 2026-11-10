import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { afterEach, describe, expect, it, vi } from "vitest";
import * as videoToolJobs from "./videoToolJobs";
import { defaultCanvasBlock, normalizeCanvasBlock, type CanvasBlock } from "./canvasTypes";
import {
  buildLocalCloudDraftSnapshot,
  cloudDraftBlocksToCanvas,
  serializeCloudDraftForUpload,
  slimBlocksForLocalPersist,
  tryLoadLocalCanvas,
  trySaveLocalCanvas,
} from "./manhuaCloudDraftSync";
import { maskMediaProviderDetails } from "./maskMediaUrls";
import { probeVideoUpscaleSource } from "./videoUpscaleApi";
import { videoEditDurationSec } from "./videoEditSubmit";
import { parseManhuaCloudDraftPayload } from "@shared/manhuaCloudDraft";
import {
  addMvFinalEditJob,
  canvasMusicMvFinalEditJobSchema,
  canvasMusicMvFinalEditSchema,
  canvasMusicMvFinalEditSubmittingSchema,
  canvasMusicMvStateSchema,
  isMvFinalEditSubmitting,
  removeMvFinalEditSubmitting,
  sanitizeMvFinalEditJobRecords,
  upsertMvFinalEditSubmitting,
  capMvFinalRecords,
  MV_FINAL_EDIT_JOBS_MAX,
  MV_FINAL_RECORDS_MAX,
  mvFinalRecordPending,
  type CanvasMusicMvState,
} from "@shared/canvasMusicMv";

const {
  applyVideoToolJobResult,
  measureVideoToolExactSec,
  measuredExactSec,
  pollVideoToolJobsOnce,
  readVideoToolJobOutcome,
  readVideoToolJobs,
  videoGradePanelSec,
} = videoToolJobs;

/** 从真实组件源码取同名表达式（useCallback 取回调本体），在受控上下文里执行，不起浏览器（同 videoGradeEntrypoints 写法）。 */
function production(file: string) {
  const source = readFileSync(new URL(`../components/canvas/${file}.tsx`, import.meta.url), "utf8");
  const tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const expressions = new Map<string, string>();
  function walk(n: ts.Node) {
    if (ts.isVariableDeclaration(n) && ts.isIdentifier(n.name) && n.initializer) {
      const init = n.initializer;
      expressions.set(n.name.text, ts.isCallExpression(init) && init.expression.getText(tree) === "useCallback" ? init.arguments[0].getText(tree) : init.getText(tree));
    }
    ts.forEachChild(n, walk);
  }
  walk(tree);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const run = (name: string, context: Record<string, unknown>): any =>
    runInNewContext(ts.transpileModule(`(${expressions.get(name)!})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText, context);
  return { source, run };
}
const free = production("FreeformCanvas"), mv = production("CanvasMusicMvStudio");

const original = "https://storage.googleapis.com/mv-bucket/canvas/7/clip-original.mp4?X-Goog-Signature=first";
const edited = (sig: string) => `https://storage.googleapis.com/mv-bucket/post-prod/7/vpe-out.mp4?X-Goog-Signature=${sig}`;
const graded = "https://storage.googleapis.com/mv-bucket/post-prod/7/concat-graded.mp4?X-Goog-Signature=g1";
const EDIT_JOB = `vpe_${"a".repeat(48)}`;
const REQUEST = "44444444-4444-4444-8444-444444444444";
/** 服务端失败/被拒时写进任务的中性句（server/services/videoPartialEdit.ts VIDEO_PARTIAL_EDIT_FAILED_MESSAGE）。 */
const SERVER_REFUNDED = "片段修改未完成，积分已全额退回，原片未受影响";

function memoryStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}
/** 刷新：走真实本机保存（trySaveLocalCanvas，含精简）与读取（tryLoadLocalCanvas → normalizeCanvasBlock，MV 状态走 strict schema）。 */
function reload(blocks: CanvasBlock[]): CanvasBlock[] {
  const storage = memoryStorage();
  expect(trySaveLocalCanvas(blocks, [], storage)).toBe(true);
  const loaded = tryLoadLocalCanvas(storage);
  expect(loaded).not.toBeNull();
  return loaded!.blocks;
}

type Jobs = Record<string, unknown | (() => never)>;
const fetchFrom = (jobs: Jobs) =>
  vi.fn(async (jobId: string) => {
    const row = jobs[jobId];
    if (typeof row === "function") return (row as () => never)();
    return row;
  });

/** 画布一次挂载：块在 store（onBlocksChange 走 updater），组件函数取自 FreeformCanvas 真实源码；只跑轮询的一轮，不起定时器。 */
function mountCanvas(blocks: CanvasBlock[], jobs: Jobs, byRequest: Jobs = {}) {
  const store = { blocks };
  const toast = { error: vi.fn(), success: vi.fn() };
  const fetchPostProdJob = fetchFrom(jobs);
  const queue = vi.fn(async (_input: unknown) => ({ jobId: "grade-job-1" }));
  const setEditPanelBlockId = vi.fn();
  const context: Record<string, unknown> = {
    ...videoToolJobs,
    get blocks() { return store.blocks; },
    blocksRef: { get current() { return store.blocks; } },
    onBlocksChangeRef: { current: (u: unknown) => { store.blocks = typeof u === "function" ? (u as (p: CanvasBlock[]) => CanvasBlock[])(store.blocks) : (u as CanvasBlock[]); } },
    settledVideoToolJobsRef: { current: new Set<string>() },
    gradeBusyId: null, gradeProbedSec: {},
    fetchPostProdJob, queuePostProd: { mutateAsync: queue },
    submitVideoGrade: async (_i: unknown, deps: { queue: (x: unknown) => Promise<{ jobId: string }> }) => (await deps.queue({ action: "concat" })).jobId,
    measureVideoToolExactSec: vi.fn(async () => 10.08),
    toast, maskMediaProviderDetails, setEditPanelBlockId, setGradeProbedSec: vi.fn(), setGradeBusyId: vi.fn(), setGradePanelBlockId: vi.fn(),
    crypto: { randomUUID: () => "55555555-5555-4555-8555-555555555555" },
    Promise, Array, String, Boolean, Error, JSON, Set, Date,
  };
  const findByRequest = fetchFrom(byRequest);
  context.fetchVideoEditJobByRequestRef = { current: findByRequest };
  for (const name of ["trackVideoToolJob", "confirmSubmittingVideoEdit", "trackVideoEditSubmitting", "applyVideoToolJobOnBlock", "failVideoToolJobOnBlock", "applyVideoEditForBlock", "pollCanvasVideoToolJobs", "resolveCanvasSubmittingVideoEdits", "openEditPanel", "startGradeForBlock"])
    context[name] = free.run(name, context);
  const pairs = () => JSON.parse(free.run("activeVideoToolJobKey", context));
  return {
    store, toast, fetchPostProdJob, queue, setEditPanelBlockId, findByRequest,
    /** 挂载即跑的一轮（effect 用的就是这对 [块, 任务] 键）：先按任务号轮询，再核对「提交中」。 */
    poll: async () => {
      const p = pairs();
      await (context.pollCanvasVideoToolJobs as (p: unknown, c: () => boolean) => Promise<void>)(p, () => false);
      await (context.resolveCanvasSubmittingVideoEdits as (p: unknown, c: () => boolean) => Promise<void>)(p, () => false);
    },
    onSubmitting: (blockId: string, p: { requestId: string; startSec: number; endSec: number; phase: "sending" | "rejected" }, sourceUrl: string) =>
      (context.trackVideoEditSubmitting as (id: string, src: string, p: unknown) => void)(blockId, sourceUrl, p),
    onSubmitted: (blockId: string, job: { jobId: string; requestId: string; startSec: number; endSec: number }, sourceUrl: string) =>
      (context.trackVideoToolJob as (id: string, j: unknown) => void)(
        blockId,
        videoToolJobs.buildVideoToolJob({ kind: "edit", jobId: job.jobId, requestId: job.requestId, sourceUrl, range: { startSec: job.startSec, endSec: job.endSec } })
      ),
    onDone: (blockId: string, src: string, result: unknown) => (context.applyVideoEditForBlock as (a: string, b: string, c: unknown) => void)(blockId, src, result),
    openEditPanel: (blockId: string) => (context.openEditPanel as (id: string) => Promise<void>)(blockId),
    startGrade: (blockId: string) => (context.startGradeForBlock as (id: string, g: unknown, u: boolean) => Promise<void>)(blockId, { all: { saturation: 1.1 } }, false),
  };
}

function videoBlock(id = "clip-v1"): CanvasBlock {
  return { ...defaultCanvasBlock("video", 0, 0), id, videoModel: "seedance-2.5", outputUrl: original, outputUrls: [original], status: "done" };
}
const blockOf = (blocks: CanvasBlock[], id = "clip-v1") => blocks.find(b => b.id === id)!;
const objectCount = (urls: string[] | undefined, url: string) => (urls || []).filter(u => u.split("?")[0] === url.split("?")[0]).length;

describe("画布视频块：局部修改提交即记任务，刷新（重新挂载）后恢复轮询", () => {
  it("提交 → 保存 → 刷新 → 处理中保持追踪且入口锁住 → 完成作新版本、原片保留、追踪清掉 → 面板 onDone / 再次刷新不重复加入", async () => {
    // 第一次挂载：面板入队成功回报 jobId/requestId/实际区间（不足 4 秒已扩展）
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 2, endSec: 6 }, original);
    expect(readVideoToolJobs(blockOf(first.store.blocks).videoToolJobs)).toEqual([
      { kind: "edit", jobId: EDIT_JOB, requestId: REQUEST, startedAt: expect.any(String), sourceUrl: original, range: { startSec: 2, endSec: 6 } },
    ]);
    // 同一任务再回报一次不重复记
    first.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 2, endSec: 6 }, original);
    expect(blockOf(first.store.blocks).videoToolJobs).toHaveLength(1);

    // 刷新：本机保存与读取后追踪字段仍在；新挂载（无任何内存状态）仍处理中 → 不动、入口锁住
    const jobs: Jobs = { [EDIT_JOB]: { status: "running", output: null, error: null } };
    const second = mountCanvas(reload(first.store.blocks), jobs);
    expect(readVideoToolJobs(blockOf(second.store.blocks).videoToolJobs).map(j => j.jobId)).toEqual([EDIT_JOB]);
    await second.poll();
    expect(second.fetchPostProdJob).toHaveBeenCalledWith(EDIT_JOB);
    expect(blockOf(second.store.blocks).outputUrl).toBe(original);
    expect(blockOf(second.store.blocks).videoToolJobs).toHaveLength(1);
    await second.openEditPanel("clip-v1");
    expect(second.setEditPanelBlockId).not.toHaveBeenCalled();
    expect(second.toast.error).toHaveBeenCalledWith(expect.stringContaining("已有局部修改在处理"));

    // 服务端完成：作为新版本加入（最前、设为当前），原片留在历史，追踪清掉
    jobs[EDIT_JOB] = { status: "succeeded", output: { url: edited("s1"), editedRange: { startSec: 2, endSec: 6 } }, error: null };
    await second.poll();
    const done = blockOf(second.store.blocks);
    expect(done.outputUrl).toBe(edited("s1"));
    expect(done.outputUrls[0]).toBe(edited("s1"));
    expect(done.outputUrls).toContain(original);
    expect(done.videoToolJobs).toBeUndefined();
    expect(second.toast.success).toHaveBeenCalledTimes(1);

    // 不重复加入：同挂载再轮询无任务可查；同任务晚到的面板 onDone（签名不同）不再加
    second.fetchPostProdJob.mockClear();
    await second.poll();
    expect(second.fetchPostProdJob).not.toHaveBeenCalled();
    second.onDone("clip-v1", original, { url: edited("s2"), jobId: EDIT_JOB });
    expect(objectCount(blockOf(second.store.blocks).outputUrls, edited("s1"))).toBe(1);
    expect(second.toast.success).toHaveBeenCalledTimes(1);
    // 再刷新一次（另一挂载、内存去重为空）：同任务回执也只按产物去重，不重复加
    const third = mountCanvas(reload(second.store.blocks), jobs);
    third.onDone("clip-v1", original, { url: edited("s3"), jobId: EDIT_JOB });
    const after = blockOf(third.store.blocks);
    expect(objectCount(after.outputUrls, edited("s1"))).toBe(1);
    expect(after.outputUrls).toHaveLength(done.outputUrls.length);
  });

  it("失败 / 被拒：提示服务端原句（积分已全额退回）与退回数额，然后清掉追踪；成片不动", async () => {
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 0, endSec: 4 }, original);
    const jobs: Jobs = { [EDIT_JOB]: { status: "failed", output: { refund: { credits: 60, refunded: true } }, error: SERVER_REFUNDED } };
    const second = mountCanvas(reload(first.store.blocks), jobs);
    await second.poll();
    const b = blockOf(second.store.blocks);
    expect(b.videoToolJobs).toBeUndefined();
    expect(b.outputUrl).toBe(original);
    expect(b.outputUrls).toEqual([original]);
    expect(second.toast.error).toHaveBeenCalledTimes(1);
    expect(second.toast.error.mock.calls[0][0]).toBe(`${SERVER_REFUNDED}（已退回 60 积分）`);
    // 清掉后不再查、不再提示
    await second.poll();
    expect(second.toast.error).toHaveBeenCalledTimes(1);
    // 追踪清掉后入口恢复可用
    await second.openEditPanel("clip-v1");
    expect(second.setEditPanelBlockId).toHaveBeenCalledWith("clip-v1");
  });

  it("查询失败按瞬态保留追踪；服务端确认任务不存在才停止跟踪", async () => {
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 0, endSec: 4 }, original);
    const jobs: Jobs = { [EDIT_JOB]: () => { throw new Error("network down"); } };
    const second = mountCanvas(reload(first.store.blocks), jobs);
    await second.poll();
    expect(blockOf(second.store.blocks).videoToolJobs).toHaveLength(1);
    jobs[EDIT_JOB] = () => { throw Object.assign(new Error("后期任务不存在"), { data: { code: "NOT_FOUND" } }); };
    await second.poll();
    expect(blockOf(second.store.blocks).videoToolJobs).toBeUndefined();
    expect(second.toast.error).toHaveBeenCalledWith(expect.stringContaining("未找到这次局部修改的任务记录"));
  });
});

describe("画布视频块：调色提交即记任务，刷新后恢复轮询", () => {
  it("提交只记任务不等结果；处理中不能重复提交；刷新后完成作新版本，原片保留", async () => {
    const first = mountCanvas([videoBlock()], {});
    await first.startGrade("clip-v1");
    expect(first.queue).toHaveBeenCalledTimes(1);
    const [job] = readVideoToolJobs(blockOf(first.store.blocks).videoToolJobs);
    expect(job).toMatchObject({ kind: "grade", jobId: "grade-job-1", requestId: "55555555-5555-4555-8555-555555555555", sourceUrl: original });
    expect(blockOf(first.store.blocks).outputUrl).toBe(original);
    // 同块调色在途：再点提交被拦，不再入队
    await first.startGrade("clip-v1");
    expect(first.queue).toHaveBeenCalledTimes(1);
    expect(first.toast.error).toHaveBeenCalledWith(expect.stringContaining("已有调色在处理"));

    const jobs: Jobs = { "grade-job-1": { status: "succeeded", output: { url: graded }, error: null } };
    const second = mountCanvas(reload(first.store.blocks), jobs);
    await second.poll();
    const b = blockOf(second.store.blocks);
    expect(b.outputUrl).toBe(graded);
    expect(b.outputUrls).toEqual([graded, original]);
    expect(b.videoToolJobs).toBeUndefined();
    expect(second.toast.success).toHaveBeenCalledWith("调色完成，已作为新版本加入，原片保留");
  });

  it("调色失败提示后清掉追踪（调色不计费，不写退积分）", async () => {
    const first = mountCanvas([videoBlock()], {});
    await first.startGrade("clip-v1");
    const second = mountCanvas(reload(first.store.blocks), { "grade-job-1": { status: "failed", output: null, error: null } });
    await second.poll();
    expect(blockOf(second.store.blocks).videoToolJobs).toBeUndefined();
    expect(second.toast.error).toHaveBeenCalledWith("调色失败");
  });
});

/** MV 一次挂载：MV 状态在 latest，onPatch 写回音乐块、onAdd 按块号并入画布（同 FreeformCanvas 接线）；函数取自 CanvasMusicMvStudio 真实源码。 */
function mountMv(blocks: CanvasBlock[], jobs: Jobs, byRequest: Jobs = {}) {
  const board = { blocks };
  const music = () => board.blocks.find(b => b.id === "music-1")!;
  const adds: string[][] = [];
  const fetch = fetchFrom(jobs);
  const findByRequest = fetchFrom(byRequest);
  const setEditOpen = vi.fn();
  const context: Record<string, unknown> = {
    alive: { current: true },
    latest: { current: music().musicMv },
    onPatch: (p: Partial<CanvasBlock>) => { board.blocks = board.blocks.map(b => (b.id === "music-1" ? { ...b, ...p } : b)); },
    onAdd: (added: CanvasBlock[]) => {
      adds.push(added.map(b => b.id));
      board.blocks = [...board.blocks, ...added.filter(a => !board.blocks.some(b => b.id === a.id))];
    },
    getBlocks: () => board.blocks,
    block: music(),
    defaultCanvasBlock,
    crypto: { randomUUID: () => crypto.randomUUID() },
    setEditOpen, setProgress: vi.fn(),
    utils: { mvAnalysis: {
      getPostProdJob: { fetch: ({ jobId }: { jobId: string }) => fetch(jobId) },
      findVideoPartialEditJob: { fetch: ({ requestId }: { requestId: string }) => findByRequest(requestId) },
    } },
    resolveSubmittingVideoToolJobsOnce: videoToolJobs.resolveSubmittingVideoToolJobsOnce,
    readFoundVideoToolJobId: videoToolJobs.readFoundVideoToolJobId,
    isPostProdJobNotFound: videoToolJobs.isPostProdJobNotFound,
    addMvFinalEditJob, canvasMusicMvFinalEditSubmittingSchema, isMvFinalEditSubmitting, removeMvFinalEditSubmitting, upsertMvFinalEditSubmitting,
    pollVideoToolJobsOnce, canvasMusicMvFinalEditJobSchema, MV_FINAL_EDIT_JOBS_MAX, capMvFinalRecords, MV_FINAL_RECORDS_MAX,
    perform: (work: () => Promise<void>) => work(),
    queuePostProd: { mutateAsync: async () => ({ jobId: "grade-new" }) },
    submitVideoGrade: async (_i: unknown, deps: { queue: (x: unknown) => Promise<{ jobId: string }> }) => (await deps.queue({ action: "concat" })).jobId,
    setGradeOpen: vi.fn(),
    String, Date, JSON, Array, Boolean, Error,
  };
  for (const name of ["patch", "patchGrade", "applyFinalEdit", "settleFinalEditJob", "pollFinalEditJobs", "trackFinalEdit", "confirmFinalEditSubmitting", "trackFinalEditSubmitting", "resolveFinalEditSubmitting", "releaseStuckGradeSubmits", "gradeFinal"])
    context[name] = mv.run(name, context);
  const state = () => (context.latest as { current: CanvasMusicMvState }).current;
  return {
    board, adds, fetch, findByRequest, setEditOpen, state,
    /** 同组件定时器的一轮：先按任务号轮询，再核对「提交中」。 */
    poll: async () => {
      await (context.pollFinalEditJobs as (c: () => boolean) => Promise<void>)(() => false);
      await (context.resolveFinalEditSubmitting as (c: () => boolean) => Promise<void>)(() => false);
    },
    onSubmitting: (p: { requestId: string; startSec: number; endSec: number; phase: "sending" | "rejected" }) =>
      (context.trackFinalEditSubmitting as (f: string, s: string, p: unknown) => void)("mv-final", original, p),
    onSubmitted: (job: { jobId: string; requestId: string; startSec: number; endSec: number }) =>
      (context.trackFinalEdit as (f: string, s: string, j: unknown) => void)("mv-final", original, job),
    onDone: (result: unknown) => (context.applyFinalEdit as (f: string, s: string, r: unknown) => void)("mv-final", original, result),
    releaseStuck: () => (context.releaseStuckGradeSubmits as () => void)(),
    gradeFinal: () => (context.gradeFinal as (g: unknown) => Promise<void>)({ all: { saturation: 1.1 } }),
  };
}

function mvBoard(extra: Partial<CanvasMusicMvState> = {}): CanvasBlock[] {
  const final = { ...defaultCanvasBlock("video", 0, 0), id: "mv-final", outputUrl: original, outputUrls: [original], status: "done" as const, prompt: "完整 MV" };
  const music = { ...defaultCanvasBlock("music", 0, 0), id: "music-1", musicMv: { status: "done", candidates: [], finalBlockId: "mv-final", ...extra } as CanvasMusicMvState };
  return [music, final];
}
/** 刷新：本机保存与读取，再过一遍云草稿序列化与恢复（musicMv 在云字段白名单内）。 */
function reloadMv(blocks: CanvasBlock[]): CanvasBlock[] {
  const local = reload(blocks);
  const parsed = parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: slimBlocksForLocalPersist(local), edges: [] })));
  expect(parsed).not.toBeNull();
  const cloud = cloudDraftBlocksToCanvas(parsed!.canvas.blocks);
  expect(cloud.find(b => b.id === "music-1")!.musicMv?.finalEditJobs).toEqual(local.find(b => b.id === "music-1")!.musicMv?.finalEditJobs);
  return local;
}

describe("MV 第 6 步成片：局部修改提交即记到 MV 草稿，刷新后恢复轮询", () => {
  it("提交 → 刷新（本机 + 云草稿往返）→ 完成挂「局部修改版」版本块、记录入 finalEdits、在途清掉 → 不重复加入", async () => {
    const first = mountMv(mvBoard(), {});
    first.onSubmitted({ jobId: EDIT_JOB, requestId: REQUEST, startSec: 8.5, endSec: 12.5 });
    first.onSubmitted({ jobId: EDIT_JOB, requestId: REQUEST, startSec: 8.5, endSec: 12.5 });
    const tracked = first.state().finalEditJobs!;
    expect(tracked).toHaveLength(1);
    expect(tracked[0]).toEqual({ kind: "edit", jobId: EDIT_JOB, requestId: REQUEST, startedAt: expect.any(String), sourceUrl: original, range: { startSec: 8.5, endSec: 12.5 }, finalBlockId: "mv-final" });
    expect(canvasMusicMvFinalEditJobSchema.safeParse(tracked[0]).success).toBe(true);

    const jobs: Jobs = { [EDIT_JOB]: { status: "queued", output: null, error: null } };
    const restored = reloadMv(first.board.blocks);
    expect(restored.find(b => b.id === "music-1")!.musicMv?.finalEditJobs).toHaveLength(1);
    const second = mountMv(restored, jobs);
    await second.poll();
    expect(second.adds).toEqual([]);
    expect(second.state().finalEditJobs).toHaveLength(1);

    jobs[EDIT_JOB] = { status: "succeeded", output: { url: edited("m1"), gcsUri: "gs://mv-bucket/post-prod/7/vpe-out.mp4", durationSec: 20.04, editedRange: { startSec: 8.5, endSec: 12.5 } }, error: null };
    await second.poll();
    expect(second.adds).toEqual([[`mvedit-mv-final-${EDIT_JOB}`]]);
    const version = second.board.blocks.find(b => b.id === `mvedit-mv-final-${EDIT_JOB}`)!;
    expect(version.outputUrl).toBe(edited("m1"));
    expect(version.prompt).toContain("局部修改版（8.5–12.5秒）");
    expect(second.board.blocks.find(b => b.id === "mv-final")!.outputUrl).toBe(original);
    const s = second.state();
    expect(s.finalEditJobs).toBeUndefined();
    expect(s.finalEdits).toHaveLength(1);
    expect(s.finalEdits![0]).toMatchObject({ finalBlockId: "mv-final", sourceUrl: original, jobId: EDIT_JOB, videoUrl: edited("m1"), editedRange: { startSec: 8.5, endSec: 12.5 }, versionBlockId: version.id });
    expect(canvasMusicMvFinalEditSchema.safeParse(s.finalEdits![0]).success).toBe(true);
    // 落盘的音乐块本身也是清掉后的状态（strict schema 读得回）
    expect(normalizeCanvasBlock(second.board.blocks.find(b => b.id === "music-1")!).musicMv?.finalEditJobs).toBeUndefined();

    // 不重复：再轮询不查；同任务面板 onDone 不再加；再刷新后另一挂载的 onDone 也不再加
    second.fetch.mockClear();
    await second.poll();
    expect(second.fetch).not.toHaveBeenCalled();
    second.onDone({ url: edited("m2"), jobId: EDIT_JOB });
    expect(second.adds).toHaveLength(1);
    const third = mountMv(reloadMv(second.board.blocks), jobs);
    third.onDone({ url: edited("m3"), jobId: EDIT_JOB });
    expect(third.adds).toEqual([]);
    expect(third.state().finalEdits).toHaveLength(1);
  });

  it("失败 / 被拒：服务端原句（积分已全额退回）写进 MV 提示并随草稿保存，在途清掉，成片不动", async () => {
    const first = mountMv(mvBoard(), {});
    first.onSubmitted({ jobId: EDIT_JOB, requestId: REQUEST, startSec: 0, endSec: 4 });
    const second = mountMv(reloadMv(first.board.blocks), { [EDIT_JOB]: { status: "failed", output: null, error: SERVER_REFUNDED } });
    await second.poll();
    expect(second.adds).toEqual([]);
    expect(second.state().finalEditJobs).toBeUndefined();
    expect(second.state().error).toBe(SERVER_REFUNDED);
    const reloaded = reloadMv(second.board.blocks).find(b => b.id === "music-1")!.musicMv!;
    expect(reloaded.error).toBe(SERVER_REFUNDED);
    expect(reloaded.finalEditJobs).toBeUndefined();
    expect(reloaded.finalEdits).toBeUndefined();
  });

  it("刷新前停在「提交中」无任务号的调色记录：挂载时改为提交结果未确认，不再挡新的调色", () => {
    const stuck = { id: "66666666-6666-4666-8666-666666666666", finalBlockId: "mv-final", sourceUrl: original, grade: { all: { saturation: 1.1 } }, status: "submitting" as const };
    const queued = { ...stuck, id: "77777777-7777-4777-8777-777777777777", status: "queued" as const, jobId: "grade-q" };
    const m = mountMv(reload(mvBoard({ finalGrades: [stuck, queued] })), {});
    m.releaseStuck();
    const grades = m.state().finalGrades!;
    expect(grades[0]).toMatchObject({ status: "submission_unknown", error: expect.stringContaining("可重新提交") });
    expect(grades[1]).toEqual(queued);
    expect(normalizeCanvasBlock(m.board.blocks.find(b => b.id === "music-1")!).musicMv?.finalGrades?.[0].status).toBe("submission_unknown");
  });
});

describe("面板实测时长：一位小数、不向上取整（10.08 秒不再传成 11 秒）", () => {
  afterEach(() => {
    delete (globalThis as { document?: unknown }).document;
  });

  it("浏览器探针：计费秒向上取整，另给原始实测秒", async () => {
    const video: Record<string, unknown> = { videoWidth: 1280, videoHeight: 720, duration: 10.08, removeAttribute() {}, load() {} };
    Object.defineProperty(video, "src", { set() { queueMicrotask(() => (video.onloadedmetadata as () => void)()); } });
    (globalThis as { document?: unknown }).document = { createElement: () => video };
    const meta = await probeVideoUpscaleSource("https://d2h7xmz5gqybh9.cloudfront.net/up/4k.mp4");
    expect(meta).toMatchObject({ durationSec: 11, durationExactSec: 10.08 });
    expect(measuredExactSec(meta)).toBe(10.08);
  });

  it("局部修改按服务端选段规则向下取一位（10.08→10.0）；调色按提交时分段校验四舍五入一位（10.08→10.1）；只有计费秒时不当片长", () => {
    expect(videoEditDurationSec(10.08)).toBe(10);
    expect(videoEditDurationSec(10.0)).toBe(10);
    expect(videoEditDurationSec(12.96)).toBe(12.9);
    expect(videoGradePanelSec(10.08)).toBe(10.1);
    expect(videoGradePanelSec(10.04)).toBe(10);
    expect(measuredExactSec({ durationExactSec: 10.08 })).toBe(10.08);
    expect(measuredExactSec({} as never)).toBeUndefined();
    expect(videoEditDurationSec(undefined)).toBe(0);
    expect(videoGradePanelSec(undefined)).toBeUndefined();
  });

  it("取实测秒：本站成片走服务端实读，高清版（CloudFront）读浏览器元数据；读失败返回空", async () => {
    const probeServer = vi.fn(async () => ({ sourceUrl: "", width: 1, height: 1, durationSec: 11, durationExactSec: 10.08, sourceResolution: "720p" }));
    const probeBrowser = vi.fn(async () => ({ sourceUrl: "", width: 1, height: 1, durationSec: 13, durationExactSec: 12.5, sourceResolution: "2k" }));
    expect(await measureVideoToolExactSec(original, { probeServer, probeBrowser })).toBe(10.08);
    expect(await measureVideoToolExactSec("https://d2h7xmz5gqybh9.cloudfront.net/up/4k.mp4", { probeServer, probeBrowser })).toBe(12.5);
    expect(probeServer).toHaveBeenCalledTimes(1);
    expect(probeBrowser).toHaveBeenCalledTimes(1);
    expect(await measureVideoToolExactSec(original, { probeServer: async () => { throw new Error("x"); } })).toBeUndefined();
    expect(await measureVideoToolExactSec("gs://mv-bucket/a.mp4", { probeServer, probeBrowser })).toBeUndefined();
  });

  it("三处面板接线：画布与 MV 传给局部修改 / 调色面板的都是实测秒按上述规则取的一位小数", async () => {
    expect(free.source).toContain("const editSec = videoEditDurationSec(gradeProbedSec[editSrc]);");
    expect(free.source).toMatch(/durationSec=\{editSec\}/);
    expect(free.source).toContain("const outputSec = videoGradePanelSec(gradeProbedSec[gradeSrc]);");
    expect(free.source).toMatch(/outputSec=\{outputSec\}/);
    expect(free.source).not.toMatch(/durationExactSec \?\? [a-z]+\??\.durationSec/);
    expect(mv.source).toContain("durationSec={videoEditDurationSec(gradeOutputSec.sec)}");
    expect(mv.source).toContain("outputSec={videoGradePanelSec(gradeOutputSec.sec) ?? gradeOutputSec.sec}");
    expect(mv.source).not.toMatch(/durationExactSec \?\? meta\.durationSec/);
    // 顾问清单里的片长与面板同一规则
    expect(mv.source).toContain("const durationSec = sec?.url === url ? videoEditDurationSec(sec.sec) : 0;");
    expect(free.source).toContain("const sec = videoEditDurationSec(cur().sec[srcOf(b)] ?? known[srcOf(b)]);");
    // 画布局部修改面板打开时记录的是实测原始秒（10.08），进面板才取一位
    const probed: Record<string, number> = {};
    const ctx: Record<string, unknown> = {
      blocks: [videoBlock()], gradeProbedSec: {}, toast: { error: vi.fn() }, setEditPanelBlockId: vi.fn(),
      setGradeProbedSec: (u: (p: Record<string, number>) => Record<string, number>) => Object.assign(probed, u(probed)),
      measureVideoToolExactSec: vi.fn(async () => 10.08), pendingVideoToolJob: videoToolJobs.pendingVideoToolJob, String,
    };
    await free.run("openEditPanel", ctx)("clip-v1");
    expect(probed[original]).toBe(10.08);
    expect(videoEditDurationSec(probed[original])).toBe(10);
  });
});

describe("回执归一与结果写回（纯函数）", () => {
  it("失败文案用服务端原句；进程失联等未写退款的句子不替它宣称已退；成功无地址按处理中；取消按失败", () => {
    expect(readVideoToolJobOutcome("edit", { status: "failed", error: SERVER_REFUNDED, output: null })).toEqual({ status: "failed", message: SERVER_REFUNDED });
    const lost = "后期执行进程已失联，原素材和任务回执保留；未自动重做，请先核对原任务";
    expect(readVideoToolJobOutcome("edit", { status: "failed", error: lost, output: null })).toEqual({ status: "failed", message: lost });
    expect(readVideoToolJobOutcome("grade", { status: "failed", error: null })).toEqual({ status: "failed", message: "调色失败" });
    expect(readVideoToolJobOutcome("edit", { status: "succeeded", output: {} })).toEqual({ status: "active" });
    expect(readVideoToolJobOutcome("edit", { status: "running" })).toEqual({ status: "active" });
    expect(readVideoToolJobOutcome("grade", { status: "cancelled" })).toMatchObject({ status: "failed" });
    expect(readVideoToolJobOutcome("grade", { status: "succeeded", output: { url: graded } })).toEqual({ status: "succeeded", url: graded });
  });

  it("写回：新版本最前、原片与当前成片都留；同产物（签名不同）不重复；只清本任务的追踪；坏条目丢弃", () => {
    const keep = { kind: "grade" as const, jobId: "g-2", requestId: "r", startedAt: "2026-11-10T00:00:00.000Z", sourceUrl: original };
    const mine = { kind: "edit" as const, jobId: EDIT_JOB, requestId: REQUEST, startedAt: "2026-11-10T00:00:00.000Z", sourceUrl: original, range: { startSec: 0, endSec: 4 } };
    const switched = "https://storage.googleapis.com/mv-bucket/canvas/7/clip-other.mp4";
    const block = { outputUrl: switched, outputUrls: [switched], videoToolJobs: [mine, keep, { jobId: "" }] };
    const r1 = applyVideoToolJobResult(block, EDIT_JOB, edited("a"));
    expect(r1.added).toBe(true);
    expect(r1.block.outputUrls).toEqual([edited("a"), switched, original]);
    expect(r1.block.videoToolJobs).toEqual([keep]);
    const r2 = applyVideoToolJobResult(r1.block, EDIT_JOB, edited("b"));
    expect(r2.added).toBe(false);
    expect(r2.block).toBe(r1.block);
    expect(readVideoToolJobs([mine, mine, { ...keep, extra: 1 }, null])).toEqual([mine]);
  });

  it("轮询一轮：处理中不回调；终态各回调一次；取消即停", async () => {
    const jobs = [
      { kind: "edit" as const, jobId: "a" },
      { kind: "grade" as const, jobId: "b" },
    ];
    const settled: string[] = [];
    await pollVideoToolJobsOnce({
      jobs,
      fetchJob: async id => (id === "a" ? { status: "running" } : { status: "succeeded", output: { url: graded } }),
      onSettled: (job, outcome) => settled.push(`${job.jobId}:${outcome.status}`),
    });
    expect(settled).toEqual(["b:succeeded"]);
    const fetchJob = vi.fn(async () => ({ status: "failed", error: SERVER_REFUNDED }));
    await pollVideoToolJobsOnce({ jobs, fetchJob, onSettled: () => {}, isCancelled: () => true });
    expect(fetchJob).not.toHaveBeenCalled();
  });
});

it("接线：面板入队即记、onDone 与轮询同一落点；轮询挂载即跑；同块同类在途时入口锁住", () => {
  expect(free.source).toMatch(/onSubmitted=\{job =>\s*trackVideoToolJob\(\s*block\.id,\s*buildVideoToolJob\(\{ kind: "edit", jobId: job\.jobId, requestId: job\.requestId, sourceUrl: editSrc, range: \{ startSec: job\.startSec, endSec: job\.endSec \} \}\)/);
  expect(free.source).toContain("onDone={result => applyVideoEditForBlock(block.id, editSrc, result)}");
  expect(free.source).toMatch(/void tick\(\);\s*const timer = window\.setInterval\(\(\) => void tick\(\), 5_000\);/);
  expect(free.source).toContain("await pollCanvasVideoToolJobsRef.current(pairs, () => cancelled);");
  expect(free.source).toContain('disabled={Boolean(pendingVideoToolJob(block.videoToolJobs, "edit"))}');
  expect(mv.source).toContain("onSubmitted={job => trackFinalEdit(state.finalBlockId!, finalSource, job)}");
  expect(mv.source).toContain("await pollFinalEditJobsRef.current(() => cancelled);");
  expect(mv.source).toContain("disabled={busy || (finalEditPending && !editOpen)}");
  expect(mv.source).toContain("busy: () => cur().busy || cur().editPending");
  // 顾问预填闸门：面板确认/报价/提交/任务进行中拒绝预填（面板代理的最小接线）
  expect(free.source).toContain("const editGuard = useVideoEditPrefillGuard();");
  expect(free.source).toContain("onAdvisorVideoEditControl(editGuard.withGuard(async (action, signal) => {");
  expect(free.source).toContain("onAdvisorPrefillGuard={editGuard.register}");
  expect(mv.source).toContain("const finalEditGuard = useVideoEditPrefillGuard();");
  expect(mv.source).toContain("register(finalEditGuard.withGuard(async (action, signal) => {");
  expect(mv.source).toContain("onAdvisorPrefillGuard={finalEditGuard.register}");
  // 前台不出现模型 / 通道名
  for (const src of [readFileSync(new URL("./videoToolJobs.ts", import.meta.url), "utf8")])
    expect(src).not.toMatch(/Seedance|EvoLink|BytePlus|Gemini|Vertex|GPT|Claude/);
});

describe("MV 成片记录上限（40 条）：写入截留、读入宽进，不再整块读不回", () => {
  const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
  const doneGrade = (i: number, finalBlockId = "mv-final") => ({ id: uuid(i), finalBlockId, sourceUrl: original, grade: { all: { saturation: 1.1 } }, status: "succeeded" as const, jobId: `g-${i}`, videoUrl: graded, versionBlockId: `mvgrade-${i}` });
  const doneEdit = (i: number) => ({ id: uuid(i), finalBlockId: "mv-final", sourceUrl: original, jobId: `vpe-${i}`, videoUrl: edited(`e${i}`), versionBlockId: `mvedit-${i}` });
  const upscale = (i: number, status: "succeeded" | "queued" = "succeeded") => ({ id: uuid(i), finalBlockId: "mv-final", sourceUrl: original, target: "2k" as const, status, taskId: `u-${i}`, durationSec: 12, creditsQuoted: 24, ...(status === "succeeded" ? { videoUrl: graded, versionBlockId: `up-${i}` } : {}) });

  it("第 41 条局部修改写入：保留最新 40 条（丢最旧的），刷新后整块草稿仍读得回", () => {
    const m = mountMv(mvBoard({ finalEdits: Array.from({ length: 40 }, (_, i) => doneEdit(i + 1)) }), {});
    m.onDone({ url: edited("new"), jobId: EDIT_JOB });
    const edits = m.state().finalEdits!;
    expect(edits).toHaveLength(MV_FINAL_RECORDS_MAX);
    expect(edits[0].jobId).toBe("vpe-2");
    expect(edits.at(-1)!.jobId).toBe(EDIT_JOB);
    const music = reload(m.board.blocks).find(b => b.id === "music-1")!;
    expect(music.musicMv?.finalEdits).toHaveLength(40);
  });

  it("第 41 条调色写入：进行中 / 待核对的不丢，丢最旧的已完成项；刷新后仍读得回", async () => {
    const pending = [
      { ...doneGrade(1, "old-final"), status: "queued" as const, videoUrl: undefined, versionBlockId: undefined },
      { ...doneGrade(2, "old-final"), status: "submission_unknown" as const, jobId: undefined, videoUrl: undefined, versionBlockId: undefined },
      { ...doneGrade(3, "old-final"), versionBlockId: undefined },
    ];
    const grades = [...pending, ...Array.from({ length: 37 }, (_, i) => doneGrade(i + 4))];
    const m = mountMv(mvBoard({ finalGrades: grades }), {});
    await m.gradeFinal();
    const kept = m.state().finalGrades!;
    expect(kept).toHaveLength(MV_FINAL_RECORDS_MAX);
    expect(kept.slice(0, 3).map(r => r.id)).toEqual(pending.map(r => r.id));
    expect(kept.some(r => r.id === uuid(4))).toBe(false);
    expect(kept.at(-1)).toMatchObject({ finalBlockId: "mv-final", status: "queued", jobId: "grade-new" });
    const music = reload(m.board.blocks).find(b => b.id === "music-1")!;
    expect(music.musicMv?.finalGrades).toHaveLength(40);
    expect(music.musicMv?.finalGrades?.filter(r => mvFinalRecordPending(r))).toHaveLength(4);
  });

  it("旧草稿 45 条：本机读取与云草稿往返都读得回，截留 40 条（进行中留下）并 console.warn，不报错", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const board = mvBoard({
        finalGrades: [{ ...doneGrade(1), status: "running" as const, videoUrl: undefined, versionBlockId: undefined }, ...Array.from({ length: 44 }, (_, i) => doneGrade(i + 2))],
        finalEdits: Array.from({ length: 45 }, (_, i) => doneEdit(i + 1)),
        finalUpscales: [upscale(1, "queued"), ...Array.from({ length: 44 }, (_, i) => upscale(i + 2))],
      });
      const storage = memoryStorage();
      storage.setItem("mv-freeform-canvas-v1", JSON.stringify({ blocks: board, edges: [] }));
      const loaded = tryLoadLocalCanvas(storage);
      expect(loaded).not.toBeNull();
      const mv = loaded!.blocks.find(b => b.id === "music-1")!.musicMv!;
      expect(mv.finalEdits!.map(r => r.jobId)).toEqual(Array.from({ length: 40 }, (_, i) => `vpe-${i + 6}`));
      expect(mv.finalGrades).toHaveLength(40);
      expect(mv.finalGrades![0]).toMatchObject({ id: uuid(1), status: "running" });
      expect(mv.finalUpscales).toHaveLength(40);
      expect(mv.finalUpscales![0]).toMatchObject({ id: uuid(1), status: "queued" });
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("超过上限 40"));
      const parsed = parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: slimBlocksForLocalPersist(board as CanvasBlock[]), edges: [] })));
      expect(parsed).not.toBeNull();
      const cloud = cloudDraftBlocksToCanvas(parsed!.canvas.blocks).find(b => b.id === "music-1")!.musicMv!;
      expect([cloud.finalGrades?.length, cloud.finalEdits?.length, cloud.finalUpscales?.length]).toEqual([40, 40, 40]);
    } finally {
      warn.mockRestore();
    }
  });

  it("截留规则：不超限原样；先丢最旧的已完成，进行中全超时才丢最旧的进行中；无状态（局部修改结果）算已完成", () => {
    const rows = ["done", "run", "done", "run", "done"].map((k, i) => ({ i, status: k === "run" ? "running" : "succeeded", versionBlockId: "v" }));
    expect(capMvFinalRecords(rows, 5)).toEqual(rows);
    expect(capMvFinalRecords(rows, 3).map(r => r.i)).toEqual([1, 3, 4]);
    expect(capMvFinalRecords(rows, 1).map(r => r.i)).toEqual([3]);
    expect(mvFinalRecordPending({ status: "succeeded" })).toBe(true);
    expect(mvFinalRecordPending({ status: "failed" })).toBe(false);
    expect(mvFinalRecordPending({ jobId: "x" })).toBe(false);
  });
});

/** 换设备 / 从云端回填：本机保存后过一遍云草稿序列化、服务端同一校验与恢复（只用云端结果，不读本机）。 */
function cloudReload(blocks: CanvasBlock[]): CanvasBlock[] {
  const serialized = serializeCloudDraftForUpload(buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: slimBlocksForLocalPersist(reload(blocks)), edges: [] }));
  expect(serialized).not.toBeNull();
  const parsed = parseManhuaCloudDraftPayload(serialized);
  expect(parsed).not.toBeNull();
  return cloudDraftBlocksToCanvas(parsed!.canvas.blocks);
}

describe("画布视频块在途任务随云草稿往返（换设备 / 云端回填不丢）", () => {
  it("已入队：云端往返后仍续查，完成作新版本加入；同任务再回执 / 再回填不重复加入", async () => {
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 2, endSec: 6 }, original);
    const restored = cloudReload(first.store.blocks);
    expect(readVideoToolJobs(blockOf(restored).videoToolJobs)).toEqual(readVideoToolJobs(blockOf(first.store.blocks).videoToolJobs));
    const jobs: Jobs = { [EDIT_JOB]: { status: "running", output: null, error: null } };
    const second = mountCanvas(restored, jobs);
    await second.poll();
    expect(blockOf(second.store.blocks).videoToolJobs).toHaveLength(1);
    jobs[EDIT_JOB] = { status: "succeeded", output: { url: edited("c1") }, error: null };
    await second.poll();
    const done = blockOf(second.store.blocks);
    expect(done.outputUrl).toBe(edited("c1"));
    expect(done.outputUrls).toContain(original);
    expect(done.videoToolJobs).toBeUndefined();
    second.onDone("clip-v1", original, { url: edited("c2"), jobId: EDIT_JOB });
    const third = mountCanvas(cloudReload(second.store.blocks), jobs);
    await third.poll();
    third.onDone("clip-v1", original, { url: edited("c3"), jobId: EDIT_JOB });
    expect(objectCount(blockOf(third.store.blocks).outputUrls, edited("c1"))).toBe(1);
    expect(blockOf(third.store.blocks).outputUrls).toHaveLength(done.outputUrls.length);
  });

  it("旧云稿无此字段照常读；坏条目丢弃、超限只截留最新 20 条，不整块拒收", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const legacy = parseManhuaCloudDraftPayload(serializeCloudDraftForUpload(buildLocalCloudDraftSnapshot({ writerSession: {}, blocks: [videoBlock()], edges: [] })));
      expect(cloudDraftBlocksToCanvas(legacy!.canvas.blocks)[0].videoToolJobs).toBeUndefined();
      const many = Array.from({ length: 25 }, (_, i) => ({ kind: "grade", jobId: `g-${i}`, requestId: `r-${i}`, startedAt: "2026-11-10T00:00:00.000Z", sourceUrl: original }));
      const raw = { ...videoBlock(), videoToolJobs: [{ jobId: "" }, null, { kind: "edit", status: "submitting", requestId: "not-a-uuid", startedAt: "x", sourceUrl: original }, ...many] };
      const restored = cloudReload([raw as CanvasBlock]);
      const b = blockOf(restored);
      expect(b.outputUrl).toBe(original);
      expect(readVideoToolJobs(b.videoToolJobs).map(j => j.jobId)).toEqual(many.slice(5).map(j => j.jobId));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining("超过上限 20"));
    } finally {
      warn.mockRestore();
    }
  });
});

describe("局部修改「提交中」：入队回执前刷新也不漏记", () => {
  const sending = { requestId: REQUEST, startSec: 2, endSec: 6, phase: "sending" as const };
  const notFound = () => { throw Object.assign(new Error("片段修改任务不存在"), { data: { code: "NOT_FOUND" } }); };

  it("发请求前先记提交中（入口锁住）→ 云端往返刷新 → 按 requestId 查到任务号补全 → 续查完成加入新版本；晚到回执不重复加入", async () => {
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitting("clip-v1", sending, original);
    first.onSubmitting("clip-v1", sending, original);
    const recs = videoToolJobs.readVideoToolJobRecords(blockOf(first.store.blocks).videoToolJobs);
    expect(recs).toEqual([{ kind: "edit", status: "submitting", requestId: REQUEST, startedAt: expect.any(String), sourceUrl: original, range: { startSec: 2, endSec: 6 } }]);
    await first.openEditPanel("clip-v1");
    expect(first.setEditPanelBlockId).not.toHaveBeenCalled();

    // 刷新（只走云端）：只剩 requestId
    const jobs: Jobs = { [EDIT_JOB]: { status: "running", output: null, error: null } };
    const second = mountCanvas(cloudReload(first.store.blocks), jobs, { [REQUEST]: { jobId: EDIT_JOB, status: "queued", output: null, error: null } });
    await second.poll();
    expect(second.findByRequest).toHaveBeenCalledWith(REQUEST);
    expect(readVideoToolJobs(blockOf(second.store.blocks).videoToolJobs)).toEqual([
      { kind: "edit", jobId: EDIT_JOB, requestId: REQUEST, startedAt: recs[0].startedAt, sourceUrl: original, range: { startSec: 2, endSec: 6 } },
    ]);
    expect(videoToolJobs.readSubmittingVideoToolJobs(blockOf(second.store.blocks).videoToolJobs)).toEqual([]);
    // 补全后按任务号轮询；同任务回执晚到也只一条
    second.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 2, endSec: 6 }, original);
    expect(blockOf(second.store.blocks).videoToolJobs).toHaveLength(1);
    jobs[EDIT_JOB] = { status: "succeeded", output: { url: edited("p1") }, error: null };
    second.findByRequest.mockClear();
    await second.poll();
    expect(second.findByRequest).not.toHaveBeenCalled();
    const done = blockOf(second.store.blocks);
    expect(done.outputUrl).toBe(edited("p1"));
    expect(done.videoToolJobs).toBeUndefined();
    second.onDone("clip-v1", original, { url: edited("p2"), jobId: EDIT_JOB });
    expect(objectCount(blockOf(second.store.blocks).outputUrls, edited("p1"))).toBe(1);
    expect(second.toast.success).toHaveBeenCalledTimes(1);
  });

  it("面板回执先到：提交中就地补全为已入队，不另加一条", () => {
    const m = mountCanvas([videoBlock()], {});
    m.onSubmitting("clip-v1", sending, original);
    m.onSubmitted("clip-v1", { jobId: EDIT_JOB, requestId: REQUEST, startSec: 2, endSec: 6 }, original);
    expect(videoToolJobs.readVideoToolJobRecords(blockOf(m.store.blocks).videoToolJobs)).toEqual([
      expect.objectContaining({ jobId: EDIT_JOB, requestId: REQUEST }),
    ]);
  });

  it("查不到：宽限内按可能仍在受理继续保留；过了宽限才清掉并提示可重新发起", async () => {
    const first = mountCanvas([videoBlock()], {});
    first.onSubmitting("clip-v1", sending, original);
    const second = mountCanvas(cloudReload(first.store.blocks), {}, { [REQUEST]: notFound });
    await second.poll();
    expect(videoToolJobs.readSubmittingVideoToolJobs(blockOf(second.store.blocks).videoToolJobs)).toHaveLength(1);
    expect(second.toast.error).not.toHaveBeenCalled();
    // 查询失败（非 NOT_FOUND）一律按瞬态，即使过了宽限
    const old = blockOf(second.store.blocks);
    const aged = { ...old, videoToolJobs: videoToolJobs.readVideoToolJobRecords(old.videoToolJobs).map(j => ({ ...j, startedAt: new Date(Date.now() - videoToolJobs.VIDEO_TOOL_SUBMIT_GRACE_MS - 1000).toISOString() })) };
    const flaky = mountCanvas([aged], {}, { [REQUEST]: () => { throw new Error("network down"); } });
    await flaky.poll();
    expect(blockOf(flaky.store.blocks).videoToolJobs).toHaveLength(1);
    const third = mountCanvas([aged], {}, { [REQUEST]: notFound });
    await third.poll();
    expect(blockOf(third.store.blocks).videoToolJobs).toBeUndefined();
    expect(third.toast.error).toHaveBeenCalledWith("这次局部修改没有提交成功，未生成新版本，可重新发起");
    await third.openEditPanel("clip-v1");
    expect(third.setEditPanelBlockId).toHaveBeenCalledWith("clip-v1");
  });

  it("服务端已回拒绝：按 requestId 核对一次，确无任务才清；查到任务（回包出错但已建任务）就补全", async () => {
    const m = mountCanvas([videoBlock()], {}, { [REQUEST]: notFound });
    m.onSubmitting("clip-v1", sending, original);
    m.onSubmitting("clip-v1", { ...sending, phase: "rejected" }, original);
    await vi.waitFor(() => expect(blockOf(m.store.blocks).videoToolJobs).toBeUndefined());
    expect(m.toast.error).not.toHaveBeenCalled();

    const n = mountCanvas([videoBlock()], {}, { [REQUEST]: { jobId: EDIT_JOB, status: "queued" } });
    n.onSubmitting("clip-v1", sending, original);
    n.onSubmitting("clip-v1", { ...sending, phase: "rejected" }, original);
    await vi.waitFor(() => expect(readVideoToolJobs(blockOf(n.store.blocks).videoToolJobs).map(j => j.jobId)).toEqual([EDIT_JOB]));
  });

  it("纯函数：被拒后用同一 requestId 重试过（发起时间更新）的不清；已入队的同请求压过提交中", () => {
    const at = Date.parse("2026-11-10T00:00:00.000Z");
    const pending = videoToolJobs.buildSubmittingVideoToolJob({ requestId: REQUEST, sourceUrl: original, now: new Date(at + 5000) })!;
    expect(videoToolJobs.removeSubmittingVideoToolJob([pending], REQUEST, at)).toEqual([pending]);
    expect(videoToolJobs.removeSubmittingVideoToolJob([pending], REQUEST, at + 5000)).toBeUndefined();
    const tracked = videoToolJobs.buildVideoToolJob({ kind: "edit", jobId: EDIT_JOB, requestId: REQUEST, sourceUrl: original })!;
    expect(videoToolJobs.readVideoToolJobRecords([pending, tracked])).toEqual([tracked]);
    expect(videoToolJobs.upsertSubmittingVideoToolJob([tracked], pending)).toEqual([tracked]);
  });
});

it("接线：面板发请求前回报提交中、画布按 requestId 续查；前台文案不出现模型 / 通道名", () => {
  expect(free.source).toContain("onSubmitting={p => trackVideoEditSubmitting(block.id, editSrc, p)}");
  expect(free.source).toContain("await resolveCanvasSubmittingVideoEditsRef.current(pairs, () => cancelled);");
  expect(free.source).toContain("postProdUtils.mvAnalysis.findVideoPartialEditJob.fetch({ requestId })");
  const panel = readFileSync(new URL("../components/canvas/VideoEditPanel.tsx", import.meta.url), "utf8");
  expect(panel).toMatch(/submit: input => \{\s*sentRequestId = input\.requestId;\s*report\(\{ requestId: input\.requestId, startSec: quote\.startSec, endSec: quote\.endSec, phase: "sending" \}\);\s*return queue\.mutateAsync\(input\);/);
  for (const src of [readFileSync(new URL("../../../shared/videoToolJob.ts", import.meta.url), "utf8")])
    expect(src).not.toMatch(/Seedance|EvoLink|BytePlus|Gemini|Vertex|GPT|Claude/);
});

describe("MV 第 6 步成片：局部修改「提交中」先记，刷新按 requestId 续查", () => {
  const sending = { requestId: REQUEST, startSec: 8.5, endSec: 12.5, phase: "sending" as const };
  const notFound = () => { throw Object.assign(new Error("片段修改任务不存在"), { data: { code: "NOT_FOUND" } }); };
  const submittingOf = (s: CanvasMusicMvState) => (s.finalEditJobs || []).filter(isMvFinalEditSubmitting);

  it("发请求前先记提交中 → 刷新（本机 + 云草稿往返）→ 按 requestId 查到任务号补全 → 完成挂新版本块；晚到回执不重复", async () => {
    const first = mountMv(mvBoard(), {});
    first.onSubmitting(sending);
    first.onSubmitting(sending);
    const recs = first.state().finalEditJobs!;
    expect(recs).toEqual([{ kind: "edit", status: "submitting", requestId: REQUEST, startedAt: expect.any(String), sourceUrl: original, range: { startSec: 8.5, endSec: 12.5 }, finalBlockId: "mv-final" }]);
    expect(canvasMusicMvFinalEditSubmittingSchema.safeParse(recs[0]).success).toBe(true);

    const jobs: Jobs = { [EDIT_JOB]: { status: "running", output: null, error: null } };
    const restored = reloadMv(first.board.blocks);
    expect(restored.find(b => b.id === "music-1")!.musicMv?.finalEditJobs).toEqual(recs);
    const second = mountMv(restored, jobs, { [REQUEST]: { jobId: EDIT_JOB, status: "queued", output: null, error: null } });
    await second.poll();
    expect(second.findByRequest).toHaveBeenCalledWith(REQUEST);
    expect(second.state().finalEditJobs).toEqual([
      { kind: "edit", jobId: EDIT_JOB, requestId: REQUEST, startedAt: recs[0].startedAt, sourceUrl: original, range: { startSec: 8.5, endSec: 12.5 }, finalBlockId: "mv-final" },
    ]);
    // 补全后的记录落盘读得回；同任务回执晚到也只一条
    expect(normalizeCanvasBlock(second.board.blocks.find(b => b.id === "music-1")!).musicMv?.finalEditJobs).toHaveLength(1);
    second.onSubmitted({ jobId: EDIT_JOB, requestId: REQUEST, startSec: 8.5, endSec: 12.5 });
    expect(second.state().finalEditJobs).toHaveLength(1);

    jobs[EDIT_JOB] = { status: "succeeded", output: { url: edited("s1"), editedRange: { startSec: 8.5, endSec: 12.5 } }, error: null };
    second.findByRequest.mockClear();
    await second.poll();
    expect(second.findByRequest).not.toHaveBeenCalled();
    expect(second.adds).toEqual([[`mvedit-mv-final-${EDIT_JOB}`]]);
    expect(second.state().finalEditJobs).toBeUndefined();
    expect(second.state().finalEdits).toHaveLength(1);
    expect(second.board.blocks.find(b => b.id === "mv-final")!.outputUrl).toBe(original);
  });

  it("面板回执先到：提交中就地补全为已入队（用服务端实际区间），不另加一条", () => {
    const m = mountMv(mvBoard(), {});
    m.onSubmitting(sending);
    m.onSubmitted({ jobId: EDIT_JOB, requestId: REQUEST, startSec: 8, endSec: 12.5 });
    expect(m.state().finalEditJobs).toEqual([expect.objectContaining({ jobId: EDIT_JOB, requestId: REQUEST, range: { startSec: 8, endSec: 12.5 } })]);
    expect(submittingOf(m.state())).toEqual([]);
  });

  it("查不到：3 分钟宽限内保留；其余查询失败按瞬态；过了宽限才清掉并留提示", async () => {
    const first = mountMv(mvBoard(), {});
    first.onSubmitting(sending);
    const second = mountMv(reloadMv(first.board.blocks), {}, { [REQUEST]: notFound });
    await second.poll();
    expect(submittingOf(second.state())).toHaveLength(1);
    expect(second.state().error).toBeUndefined();
    const aged = () => mvBoard({ finalEditJobs: [{ ...submittingOf(second.state())[0], startedAt: new Date(Date.now() - videoToolJobs.VIDEO_TOOL_SUBMIT_GRACE_MS - 1000).toISOString() }] });
    const flaky = mountMv(aged(), {}, { [REQUEST]: () => { throw new Error("network down"); } });
    await flaky.poll();
    expect(submittingOf(flaky.state())).toHaveLength(1);
    const third = mountMv(aged(), {}, { [REQUEST]: notFound });
    await third.poll();
    expect(third.state().finalEditJobs).toBeUndefined();
    expect(third.state().error).toBe("这次局部修改没有提交成功，未生成新版本，可重新发起");
    expect(third.adds).toEqual([]);
  });

  it("服务端已回拒绝：按 requestId 核对一次，确无任务才清；查到任务（回包出错但已建任务）就补全", async () => {
    const m = mountMv(mvBoard(), {}, { [REQUEST]: notFound });
    m.onSubmitting(sending);
    m.onSubmitting({ ...sending, phase: "rejected" });
    await vi.waitFor(() => expect(m.state().finalEditJobs).toBeUndefined());
    expect(m.state().error).toBeUndefined();

    const n = mountMv(mvBoard(), {}, { [REQUEST]: { jobId: EDIT_JOB, status: "queued" } });
    n.onSubmitting(sending);
    n.onSubmitting({ ...sending, phase: "rejected" });
    await vi.waitFor(() => expect(n.state().finalEditJobs).toEqual([expect.objectContaining({ jobId: EDIT_JOB, requestId: REQUEST })]));
  });

  it("记录格式宽进严出：旧草稿（只有已入队记录）可读；坏条目丢弃不拒整块；同请求已入队压过提交中；超限截留最新", () => {
    const queued = { kind: "edit" as const, jobId: EDIT_JOB, requestId: REQUEST, startedAt: "2026-11-10T00:00:00.000Z", sourceUrl: original, range: { startSec: 2, endSec: 6 }, finalBlockId: "mv-final" };
    const pending = { kind: "edit" as const, status: "submitting" as const, requestId: REQUEST, startedAt: "2026-11-10T00:00:05.000Z", sourceUrl: original, range: { startSec: 2, endSec: 6 }, finalBlockId: "mv-final" };
    const other = { ...pending, requestId: "55555555-5555-4555-8555-555555555555" };
    const base = { status: "done", candidates: [], finalBlockId: "mv-final" };
    // 旧草稿
    expect(canvasMusicMvStateSchema.parse({ ...base, finalEditJobs: [queued] }).finalEditJobs).toEqual([queued]);
    expect(canvasMusicMvStateSchema.parse(base).finalEditJobs).toBeUndefined();
    // 坏条目（缺 finalBlockId、requestId 非 uuid、未知字段、非对象）只丢自己
    const mixed = [queued, { ...pending, finalBlockId: undefined }, { ...other, requestId: "not-a-uuid" }, { ...other, extra: 1 }, null, other, pending];
    const parsed = canvasMusicMvStateSchema.safeParse({ ...base, finalEditJobs: mixed });
    expect(parsed.success).toBe(true);
    expect(parsed.success && parsed.data.finalEditJobs).toEqual([queued, other]);
    expect(canvasMusicMvStateSchema.parse({ ...base, finalEditJobs: "broken" }).finalEditJobs).toEqual([]);
    // 纯函数
    expect(upsertMvFinalEditSubmitting([queued], pending)).toEqual([queued]);
    expect(upsertMvFinalEditSubmitting([pending], { ...pending, startedAt: "2026-11-10T00:01:00.000Z" })).toEqual([{ ...pending, startedAt: "2026-11-10T00:01:00.000Z" }]);
    expect(addMvFinalEditJob([other, pending], queued)).toEqual([other, queued]);
    const at = Date.parse(pending.startedAt);
    expect(removeMvFinalEditSubmitting([pending], REQUEST, at - 1)).toEqual([pending]);
    expect(removeMvFinalEditSubmitting([pending, other], REQUEST, at)).toEqual([other]);
    const many = Array.from({ length: MV_FINAL_EDIT_JOBS_MAX + 3 }, (_, i) => ({ ...queued, jobId: `vpe_${i}`, requestId: `r-${i}` }));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const kept = sanitizeMvFinalEditJobRecords(many);
    expect(kept).toHaveLength(MV_FINAL_EDIT_JOBS_MAX);
    expect((kept[0] as { jobId: string }).jobId).toBe("vpe_3");
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });

  it("MV 面板接了 onSubmitting，在途条区分提交中 / 处理中，前台不出现模型或通道名", () => {
    expect(mv.source).toContain("onSubmitting={p => trackFinalEditSubmitting(state.finalBlockId!, finalSource, p)}");
    expect(mv.source).toContain('isMvFinalEditSubmitting(t) ? "提交中" : "处理中"');
    expect(mv.source).toContain("await resolveFinalEditSubmittingRef.current(() => cancelled);");
  });
});
