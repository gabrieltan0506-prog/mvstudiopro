/**
 * 纯图片 PDF 导出改为「发起即返回任务标识、后台执行、前台轮询」（1111）。
 *
 * 原 exportKnowledgeCardPdf 是一条同步长请求：逐页取 4K 成品图 → 归一 → 拼页 → 上传。
 * 正式站实测 2 页约 37 秒，三十多页要数分钟，超过网关等待上限后请求被截断，
 * 前台只看到「PDF 导出中断了」，而服务端其实还在合成——所以多页导出几乎必然失败。
 *
 * 语义：
 * - 任务键 = 账号 | 图片清单摘要；同键重复发起复用进行中/已完成的任务（刷新或重复点击不重复合成）。
 * - 只在进程内存放任务状态；查询时校验账号，绝不返回他人任务。
 * - 进程重启后注册表清空：前台拿到 missing 后用同一清单重新发起。
 */
import { createHash } from "node:crypto";

export type KnowledgeCardPdfResult = { gcsUri: string; url: string; pageCount: number };

export type KnowledgeCardPdfTaskState =
  | { status: "running"; taskId: string; startedAt: number; donePages: number; totalPages: number }
  | { status: "succeeded"; taskId: string; startedAt: number; finishedAt: number; result: KnowledgeCardPdfResult }
  | { status: "failed"; taskId: string; startedAt: number; finishedAt: number; error: string };

type Task = { owner: number; state: KnowledgeCardPdfTaskState; promise: Promise<void> };
type Deps = {
  run: (params: { userId: number; imageUrls: string[]; title?: string; onPage: (done: number) => void }) => Promise<KnowledgeCardPdfResult>;
  now?: () => number;
};

const KEEP_FINISHED_MS = 30 * 60_000;
const MAX_TASKS = 200;

/** 签名地址每次签发都不同：任务键只取去掉查询串后的对象地址，保证同一批图得到同一任务。 */
export function knowledgeCardPdfTaskKey(owner: number, imageUrls: string[]): string {
  const stable = imageUrls.map((u) => String(u).split("?")[0]).join("\n");
  return createHash("sha256").update(`${owner}|${stable}`).digest("hex").slice(0, 32);
}

function publicMessage(error: unknown): string {
  const raw = String((error as Error)?.message ?? error ?? "").replace(/(?:https?|gs):\/\/\S+/g, "[地址]");
  return raw.slice(0, 160) || "PDF 合成失败，请稍后重试";
}

export function createKnowledgeCardPdfTasks(deps: Deps) {
  const tasks = new Map<string, Task>();
  const now = deps.now ?? Date.now;
  const prune = () => {
    for (const [id, task] of Array.from(tasks.entries()))
      if (task.state.status !== "running" && now() - task.state.finishedAt > KEEP_FINISHED_MS) tasks.delete(id);
    while (tasks.size > MAX_TASKS) {
      const oldest = Array.from(tasks.entries()).find(([, t]) => t.state.status !== "running");
      if (!oldest) break;
      tasks.delete(oldest[0]);
    }
  };
  return {
    /** 该账号是否已有同一清单的进行中/已完成任务（复用时不计入节流）。 */
    reusable(owner: number, imageUrls: string[]): KnowledgeCardPdfTaskState | null {
      prune();
      const prior = tasks.get(knowledgeCardPdfTaskKey(owner, imageUrls));
      return prior && prior.owner === owner && prior.state.status !== "failed" ? prior.state : null;
    },
    /** 该账号是否有任何进行中的导出（同一时间只合成一份，避免多份 4K 同时占内存）。 */
    hasRunning(owner: number): boolean {
      return Array.from(tasks.values()).some((t) => t.owner === owner && t.state.status === "running");
    },
    start(owner: number, imageUrls: string[], title?: string): KnowledgeCardPdfTaskState {
      const prior = this.reusable(owner, imageUrls);
      if (prior) return prior;
      const taskId = knowledgeCardPdfTaskKey(owner, imageUrls);
      const startedAt = now();
      const task: Task = {
        owner,
        state: { status: "running", taskId, startedAt, donePages: 0, totalPages: imageUrls.length },
        promise: Promise.resolve(),
      };
      task.promise = deps
        .run({
          userId: owner,
          imageUrls,
          title,
          onPage: (done) => {
            if (task.state.status === "running") task.state = { ...task.state, donePages: done };
          },
        })
        .then(
          (result) => {
            task.state = { status: "succeeded", taskId, startedAt, finishedAt: now(), result };
            console.log(`[knowledgeCardPdf] task ok pages=${result.pageCount} ms=${now() - startedAt}`);
          },
          (error) => {
            const message = publicMessage(error);
            console.warn(`[knowledgeCardPdf] task failed ms=${now() - startedAt} reason=${message}`);
            task.state = { status: "failed", taskId, startedAt, finishedAt: now(), error: message };
          },
        );
      tasks.set(taskId, task);
      return task.state;
    },
    /** 查询只返回本人任务；未知（含进程重启后）返回 null，由前台重新发起。 */
    status(owner: number, taskId: string): KnowledgeCardPdfTaskState | null {
      const task = tasks.get(taskId);
      if (!task || task.owner !== owner) return null;
      return task.state;
    },
    /** 测试用：等待任务结束。 */
    async settled(taskId: string) {
      await tasks.get(taskId)?.promise;
    },
  };
}

let shared: ReturnType<typeof createKnowledgeCardPdfTasks> | undefined;
export function knowledgeCardPdfTasks() {
  shared ??= createKnowledgeCardPdfTasks({
    run: async (params) => (await import("./knowledgeCardPdfExport.js")).exportKnowledgeCardPdfToGcs(params),
  });
  return shared;
}
