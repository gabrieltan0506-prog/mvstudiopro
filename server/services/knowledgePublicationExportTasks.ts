/**
 * 图文手册导出改为「发起即返回任务标识、后台执行、前台轮询」（1111）。
 *
 * 原 exportPublication 是一条同步长请求（整册分段测量 + 渲染 + 合并，历史上单次可达数十分钟），页面刷新或网络抖动即丢结果。
 *
 * 语义：
 * - 任务键 = 账号 | 稿件 | 云稿 generation；同键重复发起复用进行中/已完成的任务（刷新后重新发起即可续看）。
 * - 同一成品目录（导出前缀，由内容摘要决定）已有进行中的导出时，新任务直接等待那一次，不重复渲染。
 * - 结算幂等沿用 exportKnowledgePublication 内既有逻辑（按稿件结算键，重复导出不重复扣费）。
 * - 进程重启后注册表清空：用户重新发起即可，已完成的分片（pdf-parts）与成品清单在云端复用，不重做已完成部分。
 * - 只在进程内存放任务状态，键含账号；查询时校验账号，绝不返回他人任务。
 */
import { createHash } from "node:crypto";
import { knowledgePublicationPublicError } from "../../shared/knowledgePublicationPublic";
import type { KnowledgePublicationExport } from "./knowledgePublicationExport";
import { knowledgeTimingLog } from "./knowledgePublicationCache";

export type KnowledgeExportTaskState =
  | { status: "running"; taskId: string; startedAt: number }
  | { status: "succeeded"; taskId: string; startedAt: number; finishedAt: number; result: KnowledgePublicationExport }
  | { status: "failed"; taskId: string; startedAt: number; finishedAt: number; error: string; retryable: boolean };

type Task = { owner: number; key: string; state: KnowledgeExportTaskState; promise: Promise<void> };
type Deps = {
  run: (owner: number, documentId: string, generation: string) => Promise<KnowledgePublicationExport>;
  /** 取导出成品目录（同目录去重）；取不到时按任务键去重即可。 */
  prefix?: (owner: number, documentId: string, generation: string) => Promise<string>;
  now?: () => number;
};

const KEEP_FINISHED_MS = 30 * 60_000;
const MAX_TASKS = 200;

export function createKnowledgeExportTasks(deps: Deps) {
  const tasks = new Map<string, Task>();
  const byPrefix = new Map<string, Promise<KnowledgePublicationExport>>();
  const now = deps.now ?? Date.now;
  const taskIdOf = (key: string) => createHash("sha256").update(key).digest("hex").slice(0, 32);
  const prune = () => {
    for (const [id, task] of Array.from(tasks.entries()))
      if (task.state.status !== "running" && now() - task.state.finishedAt > KEEP_FINISHED_MS) tasks.delete(id);
    while (tasks.size > MAX_TASKS) {
      const oldest = Array.from(tasks.entries()).find(([, t]) => t.state.status !== "running");
      if (!oldest) break;
      tasks.delete(oldest[0]);
    }
  };
  const execute = async (owner: number, documentId: string, generation: string) => {
    let prefix: string | undefined;
    try { prefix = deps.prefix ? await deps.prefix(owner, documentId, generation) : undefined; } catch { prefix = undefined; }
    const prefixKey = prefix ? `${owner}|${prefix}` : undefined;
    const existing = prefixKey ? byPrefix.get(prefixKey) : undefined;
    if (existing) return existing;
    const promise = deps.run(owner, documentId, generation);
    if (prefixKey) {
      byPrefix.set(prefixKey, promise);
      void promise.finally(() => { if (byPrefix.get(prefixKey) === promise) byPrefix.delete(prefixKey); }).catch(() => undefined);
    }
    return promise;
  };
  return {
    start(owner: number, documentId: string, generation: string): KnowledgeExportTaskState {
      prune();
      const key = `${owner}|${documentId}|${generation}`;
      const taskId = taskIdOf(key);
      const prior = tasks.get(taskId);
      // 进行中或已成功：复用；失败：允许重新发起（已完成分片在云端复用）。
      if (prior && prior.owner === owner && prior.state.status !== "failed") return prior.state;
      const startedAt = now();
      const task: Task = { owner, key, state: { status: "running", taskId, startedAt }, promise: Promise.resolve() };
      task.promise = execute(owner, documentId, generation).then(result => {
        task.state = { status: "succeeded", taskId, startedAt, finishedAt: now(), result };
        knowledgeTimingLog("knowledgeExport.task", startedAt, { ok: true, pages: result.totalPages });
      }, error => {
        const safe = knowledgePublicationPublicError(error);
        console.warn(`[knowledgeExport] task failed reason=${String((error as Error)?.message ?? error).replace(/(?:https?|gs):\/\/\S+/g, "[地址]").slice(0, 300)}`);
        task.state = { status: "failed", taskId, startedAt, finishedAt: now(), error: safe.message, retryable: safe.retryable };
        knowledgeTimingLog("knowledgeExport.task", startedAt, { ok: false });
      });
      tasks.set(taskId, task);
      return task.state;
    },
    /** 查询只返回本人任务；未知（含进程重启后）返回 null，由前台重新发起。 */
    status(owner: number, taskId: string): KnowledgeExportTaskState | null {
      const task = tasks.get(taskId);
      if (!task || task.owner !== owner) return null;
      return task.state;
    },
    /** 测试用：等待任务结束。 */
    async settled(taskId: string) { await tasks.get(taskId)?.promise; },
  };
}

let shared: ReturnType<typeof createKnowledgeExportTasks> | undefined;
export function knowledgeExportTasks() {
  shared ??= createKnowledgeExportTasks({
    run: async (owner, documentId, generation) => (await import("./knowledgePublicationExport")).exportKnowledgePublication(owner, documentId, generation),
    prefix: async (owner, documentId, generation) => {
      const { loadKnowledgeBookLayoutView } = await import("./knowledgeBookLayout");
      // 与导出共用同一 generation 的视图缓存，几乎不增加耗时。
      return (await loadKnowledgeBookLayoutView(owner, documentId, generation, {}, { cache: true })).prefix;
    },
  });
  return shared;
}
