import { expect, it } from "vitest";
import { createKnowledgeExportTasks } from "./knowledgePublicationExportTasks";

const deferred = <T,>() => { let resolve!: (v: T) => void, reject!: (e: unknown) => void; const promise = new Promise<T>((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const result = { htmlUrl: "h", htmlBytes: 1, chapters: 1, pdfUrl: "p", totalPages: 3, imagePages: 1 } as any;

it("发起即返回任务标识；同一账号+稿件+版本重复发起复用进行中任务；完成后查询拿到结果", async () => {
  const gate = deferred<any>(); let runs = 0;
  const tasks = createKnowledgeExportTasks({ run: async () => { runs++; return gate.promise; } });
  const first = tasks.start(7, "doc", "10");
  expect(first.status).toBe("running");
  expect(tasks.start(7, "doc", "10").taskId).toBe(first.taskId);
  expect(runs).toBe(1);
  expect(tasks.status(7, first.taskId)?.status).toBe("running");
  gate.resolve(result); await tasks.settled(first.taskId);
  expect(tasks.status(7, first.taskId)).toMatchObject({ status: "succeeded", result });
  // 成功后再发起（刷新续看）直接复用，不重跑。
  expect(tasks.start(7, "doc", "10").status).toBe("succeeded"); expect(runs).toBe(1);
});
it("查询只返回本人任务；未知任务为 null（前台据此重新发起）", () => {
  const tasks = createKnowledgeExportTasks({ run: () => new Promise(() => undefined) });
  const state = tasks.start(7, "doc", "10");
  expect(tasks.status(8, state.taskId)).toBeNull();
  expect(tasks.status(7, "0".repeat(32))).toBeNull();
});
it("失败返回业务提示且允许重新发起；同一成品目录的新版本任务等待进行中的那一次，不重复渲染", async () => {
  let runs = 0; const gate = deferred<any>();
  const tasks = createKnowledgeExportTasks({ run: async () => { runs++; if (runs === 1) throw Error("pdf worker gs://secret 超时"); return gate.promise; }, prefix: async () => "same-product" });
  const failed = tasks.start(7, "doc", "10"); await tasks.settled(failed.taskId);
  const state = tasks.status(7, failed.taskId)!;
  expect(state.status).toBe("failed");
  expect(JSON.stringify(state)).not.toContain("gs://");
  const retry = tasks.start(7, "doc", "10"); expect(retry.status).toBe("running");
  const other = tasks.start(7, "doc", "11");
  expect(other.taskId).not.toBe(retry.taskId);
  gate.resolve(result);
  await tasks.settled(retry.taskId); await tasks.settled(other.taskId);
  expect(runs).toBe(2);
  expect(tasks.status(7, other.taskId)).toMatchObject({ status: "succeeded" });
});
