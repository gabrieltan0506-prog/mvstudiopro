// 1121 导出任务的分项进度：running 状态带可选 progress（进程内），结束后保留最后一次；旧调用方不读 progress 不受影响。
import { expect, it } from "vitest";
import { createKnowledgeExportTasks, knowledgeExportLeaseName, type KnowledgeExportTaskStore } from "./knowledgePublicationExportTasks";
import type { KnowledgeExportProgress, KnowledgeExportProgressListener } from "./knowledgePublicationExport";
import { knowledgeStageLabel } from "../../client/src/lib/knowledgePublicationStage";

const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = { htmlUrl: "h", htmlBytes: 1, chapters: 3, pdfUrl: "p", totalPages: 9, imagePages: 2 } as any;
const render = (done: number, total = 3): KnowledgeExportProgress => ({ phase: "render", done, total, label: `渲染各段 PDF ${done}/${total} 段` });

it("进度随分段完成单调增加、最终等于总数；结束后保留最后一次进度，迟到的进度不再改写", async () => {
  const gate = deferred<any>(); let report!: KnowledgeExportProgressListener;
  const tasks = createKnowledgeExportTasks({ run: async (_o, _d, _g, onProgress) => { report = onProgress!; return gate.promise; } });
  const state = await tasks.start(7, "doc", "10");
  await Promise.resolve();
  expect(tasks.status(7, state.taskId)).toEqual({ status: "running", taskId: state.taskId, startedAt: state.startedAt });
  const seen: number[] = [];
  for (let done = 0; done <= 3; done++) { report(render(done)); seen.push((tasks.status(7, state.taskId) as any).progress.done); }
  expect(seen).toEqual([0, 1, 2, 3]);
  expect(tasks.status(7, state.taskId)).toMatchObject({ status: "running", progress: { done: 3, total: 3 } });
  gate.resolve(result); await tasks.settled(state.taskId);
  report(render(0));
  expect(tasks.status(7, state.taskId)).toMatchObject({ status: "succeeded", result, progress: { done: 3, total: 3 } });
});

it("失败与部分完成：如实停在实际位置", async () => {
  let report!: KnowledgeExportProgressListener; const gate = deferred<any>();
  const tasks = createKnowledgeExportTasks({ run: async (_o, _d, _g, onProgress) => { report = onProgress!; return gate.promise; } });
  const state = await tasks.start(7, "doc", "10"); await Promise.resolve();
  report(render(1)); report({ phase: "partial", done: 1, total: 3, failed: 2, label: "PDF 已完成 1/3 段，2 段未完成，可继续生成" });
  gate.resolve({ htmlUrl: "h", htmlBytes: 1, chapters: 3, pdfError: "HTML已保存，PDF有2段未完成" });
  await tasks.settled(state.taskId);
  expect(tasks.status(7, state.taskId)).toMatchObject({ status: "succeeded", progress: { phase: "partial", done: 1, failed: 2 } });

  const failing = createKnowledgeExportTasks({ run: async (_o, _d, _g, onProgress) => { onProgress!(render(2)); throw Error("渲染中断"); } });
  const f = await failing.start(7, "doc", "10"); await failing.settled(f.taskId);
  expect(failing.status(7, f.taskId)).toMatchObject({ status: "failed", progress: { done: 2, total: 3 } });
});

it("旧调用方：run 不上报进度时，状态与原先逐字相同（无 progress 字段）", async () => {
  const tasks = createKnowledgeExportTasks({ run: async () => result });
  const state = await tasks.start(7, "doc", "10");
  expect(Object.keys(state).sort()).toEqual(["startedAt", "status", "taskId"]);
  await tasks.settled(state.taskId);
  expect(Object.keys(tasks.status(7, state.taskId)!).sort()).toEqual(["finishedAt", "result", "startedAt", "status", "taskId"]);
});

it("同一成品目录复用进行中的那一次：后发起的任务看到同一份进度", async () => {
  const gate = deferred<any>(); let report!: KnowledgeExportProgressListener; let runs = 0;
  const tasks = createKnowledgeExportTasks({ run: async (_o, _d, _g, onProgress) => { runs++; report = onProgress!; return gate.promise; }, prefix: async () => "same" });
  const a = await tasks.start(7, "doc", "10"); await new Promise(r => setTimeout(r, 0));
  report(render(1));
  const b = await tasks.start(7, "doc", "11"); await new Promise(r => setTimeout(r, 0));
  expect(tasks.status(7, b.taskId)).toMatchObject({ progress: { done: 1 } });
  report(render(2));
  expect(tasks.status(7, a.taskId)).toMatchObject({ progress: { done: 2 } });
  expect(tasks.status(7, b.taskId)).toMatchObject({ progress: { done: 2 } });
  expect(runs).toBe(1);
  gate.resolve(result); await tasks.settled(a.taskId); await tasks.settled(b.taskId);
});

it("他人持有新鲜租约：进度说明「另一处生成，完成后直接复用」；取得租约后转为实际进度", async () => {
  const objects = new Map<string, { value: any; generation: string }>(); let gen = 0;
  const store: KnowledgeExportTaskStore = {
    async read(name) { const o = objects.get(name); return o ? { value: structuredClone(o.value), generation: o.generation } : null; },
    async write(name, value, ifGeneration) { const cur = objects.get(name); if (ifGeneration === null ? !!cur : cur?.generation !== ifGeneration) return { ok: false }; const generation = String(++gen); objects.set(name, { value: structuredClone(value), generation }); return { ok: true, generation }; },
    async put(name, value) { objects.set(name, { value: structuredClone(value), generation: String(++gen) }); },
  };
  let clock = 1_000_000;
  const lease = knowledgeExportLeaseName(7, "7|same");
  objects.set(lease, { value: { kind: "knowledge_export_lease_v1", renderKey: "7|same", holder: "other", status: "running", startedAt: clock, heartbeatAt: clock }, generation: "1" });
  const waiting = deferred<void>(); const release = deferred<void>(); let polls = 0;
  const tasks = createKnowledgeExportTasks({
    run: async (_o, _d, _g, onProgress) => { onProgress!(render(3)); return result; },
    prefix: async () => "same", store, now: () => clock, holder: "me", every: () => () => undefined,
    sleep: async () => { if (++polls === 1) { waiting.resolve(); await release.promise; } },
  });
  const state = await tasks.start(7, "doc", "10");
  await waiting.promise;
  expect(tasks.status(7, state.taskId)).toMatchObject({ status: "running", progress: { phase: "waiting", done: 0, total: 0 } });
  expect((tasks.status(7, state.taskId) as any).progress.label).toContain("另一处生成");
  objects.set(lease, { value: { ...objects.get(lease)!.value, status: "succeeded" }, generation: String(++gen) });
  release.resolve();
  await tasks.settled(state.taskId);
  expect(tasks.status(7, state.taskId)).toMatchObject({ status: "succeeded", progress: { phase: "render", done: 3 } });
});

it("前台阶段文案：第 4 步按「段」计数", () => {
  expect(knowledgeStageLabel({ step: 3, done: 12, total: 48 })).toBe("逐章整理 ✓ → 统稿 ✓ → 整册排版 ✓ → 【版面审查与 PDF 12/48 段】");
  expect(knowledgeStageLabel({ step: 0, done: 1, total: 2 })).toBe("【逐章整理 1/2】 → 统稿 → 整册排版 → 版面审查与 PDF");
});
