import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ rows: new Map<string, any>(), inserts: [] as any[], cancelCalls: [] as any[] }));
vi.mock("../db", () => ({ getDb: async () => ({ insert: () => ({ values: (row: any) => ({ onConflictDoNothing: async () => {
  state.inserts.push(row);
  if (!state.rows.has(row.id)) state.rows.set(row.id, JSON.parse(JSON.stringify(row)));
} }) }) }) }));
vi.mock("./repository", () => ({
  getJobByIdStrict: async (id: string) => state.rows.get(id) || null,
  createJob: vi.fn(),
  requestPlatformJobCancel: async (args: any) => {
    state.cancelCalls.push(args);
    const row = state.rows.get(args.jobId);
    if (!row || row.userId !== args.userId || !args.actions.includes(row.input.action)) return null;
    if (row.status === 'failed' || row.status === 'succeeded' || row.output?.knowledgeCardSettlement) return row;
    row.input.cancelRequestedAt = new Date().toISOString();
    if (row.status === 'queued') row.status = 'failed';
    return row;
  },
}));
import { cancelKnowledgeCardPageRequest, createKnowledgeCardPageJob, knowledgeCardPageJobId } from "./knowledgeCardPageTask";
const request = { userId: "1", action: "knowledge_card_distill" as const, requestId: "13304dee-9292-4a81-923d-2f6a5c6b1a3d" };
beforeEach(() => { state.rows.clear(); state.inserts = []; state.cancelCalls = []; });
describe("刷新与知识卡建单竞争", () => {
  it("先刷新、后入队：取消占位不能被迟到提交复活，也不提交第二单", async () => {
    await cancelKnowledgeCardPageRequest(request);
    const id = await createKnowledgeCardPageJob({ ...request, params: { sourceText: "迟到原文" } });
    await createKnowledgeCardPageJob({ ...request, params: { sourceText: "迟到原文" } });
    expect(state.rows.size).toBe(1);
    expect(state.rows.get(id)).toMatchObject({ status: "failed", attempts: 0 });
    expect(state.rows.get(id).input.cancelRequestedAt).toBeTruthy();
    expect(state.rows.get(id).input.params).toBeUndefined();
  });
  it("先入队、后刷新：只停止这单，保留原输入", async () => {
    const id = await createKnowledgeCardPageJob({ ...request, params: { sourceText: "保留原文" } });
    await cancelKnowledgeCardPageRequest(request);
    expect(state.rows.get(id)).toMatchObject({ status: "failed", input: { params: { sourceText: "保留原文" } } });
    expect(state.cancelCalls[0]).toMatchObject({ userId: "1", jobId: id, actions: ["knowledge_card_distill"] });
  });
  it("正在跑的交给现有取消监视器，结算中与成功结果不覆盖", async () => {
    const id = await createKnowledgeCardPageJob({ ...request, params: {} });
    const row = state.rows.get(id); row.status = "running";
    await cancelKnowledgeCardPageRequest(request);
    expect(row.input.cancelRequestedAt).toBeTruthy();
    expect(row.status).toBe("running");
    delete row.input.cancelRequestedAt;
    row.output = { knowledgeCardSettlement: { markdown: "完成稿" } };
    await cancelKnowledgeCardPageRequest(request);
    expect(row.input.cancelRequestedAt).toBeUndefined();
    row.status = "succeeded";
    await cancelKnowledgeCardPageRequest(request);
    expect(row.output.knowledgeCardSettlement.markdown).toBe("完成稿");
  });
  it("可选文件名省略后数据库JSON归一化不误判为另一份原稿", async () => {
    const id = await createKnowledgeCardPageJob({ ...request, params: { files: [{ fileName: undefined, mimeType: "application/pdf" }] } });
    expect(state.rows.get(id).status).toBe("queued");
  });
  it("相同请求不能静默替换原稿", async () => {
    await createKnowledgeCardPageJob({ ...request, params: { sourceText: "原稿" } });
    await expect(createKnowledgeCardPageJob({ ...request, params: { sourceText: "另一份" } })).rejects.toThrow("另一份原稿");
    expect(state.rows.size).toBe(1);
  });
  it("相同 UUID 隔离账号与派生任务，非法请求不落库", async () => {
    const a = knowledgeCardPageJobId("1", request.action, request.requestId);
    const b = knowledgeCardPageJobId("2", request.action, request.requestId);
    const c = knowledgeCardPageJobId("1", "knowledge_card_derive_level", request.requestId);
    expect(new Set([a,b,c]).size).toBe(3);
    await expect(cancelKnowledgeCardPageRequest({ ...request, requestId: "other-job-id" })).rejects.toThrow();
    expect(state.rows.size).toBe(0);
  });
});
