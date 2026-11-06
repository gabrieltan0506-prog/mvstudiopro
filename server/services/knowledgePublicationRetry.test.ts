import { beforeEach, describe, expect, it, vi } from "vitest";
import { layoutFromSource, type LayoutLibrary } from "../../shared/editableLayout";
import { knowledgeBatchRequestId } from "../../shared/knowledgePublication";
const state = vi.hoisted(() => ({ job: null as any, charged: 12, settled: true, records: new Map<string, unknown>() }));
vi.mock("../jobs/repository", () => ({ getJobByIdStrict: vi.fn(async () => state.job) }));
vi.mock("../credits", () => ({ readChargeRefundState: vi.fn(async () => ({ charged: state.charged, settled: state.settled })) }));
vi.mock("./gcs", () => ({
  getGcsBucketName: () => "test", uploadBufferToGcs: vi.fn(), signGsUriV4ReadUrl: (uri: string) => uri,
  downloadGcsObjectVersioned: vi.fn(async ({ gcsUri }: { gcsUri: string }) => {
    const value = state.records.get(gcsUri.split("/").at(-1)!);
    if (!value) throw new Error("gcs_stat_failed:404");
    return { buffer: Buffer.from(JSON.stringify(value)) };
  }),
}));
import { checkKnowledgePublicationRetry, validateKnowledgePublicationRetryTransition } from "./knowledgePublicationRetry";
import { readLayoutLibrary, writeLayoutLibrary } from "./editableLayoutStore";

function fixture() {
  const doc = layoutFromSource({ kind: "knowledge-publication", owner: "7", sourceId: "retry", title: "完整原稿", body: "原始知识内容" });
  state.job = { userId: "7", status: "failed", input: { requestId: knowledgeBatchRequestId(doc.publication!.requestId, 0, 0) },
    output: { action: "manhua_advisor_qa_refund_reconciled", creditsRefunded: 12 } };
  return doc;
}
function storage() {
  let value: { buffer: Buffer; generation: string } | undefined;
  return {
    read: vi.fn(async () => { if (!value) throw new Error("gcs_stat_failed:404"); return value; }),
    write: vi.fn(async (input: any) => {
      if (input.ifGenerationMatch !== (value?.generation || "0")) throw new Error("gcs_upload_failed:412:{}");
      value = { buffer: input.buffer, generation: String(Number(value?.generation || 0) + 1) };
      return value;
    }),
  } as any;
}
beforeEach(() => { state.records.clear(); state.charged = 12; state.settled = true; });

describe("KH-ROUTE-02 保存前验证真实失败和恢复边界", () => {
  it.each(["route-glm-evolink-retry-3.json", "accepted.json", "raw-0.json", "report.json"])("%s已存在时拒绝新编号，旧稿原编号仍可恢复", async key => {
    const doc = fixture(), deps = storage();
    const library: LayoutLibrary = { version: 1, owner: "7", documents: [doc] };
    await writeLayoutLibrary(7, library, "0", deps);
    state.records.set(key, key.startsWith("route-") ? { state: "received", response: { status: 200, text: "已收原文" } } : { saved: true });
    const changed = structuredClone(library); changed.documents[0].publication!.attempts["0"] = 1;
    await expect(writeLayoutLibrary(7, changed, "1", deps)).rejects.toThrow(/原请求|结果尚待核实/);
    const restored = await readLayoutLibrary(7, deps);
    expect(restored.generation).toBe("1");
    expect(restored.library!.documents[0].publication!.attempts).toEqual({});
    expect(restored.library!.documents[0].publication!.requestId).toBe(doc.publication!.requestId);
    await writeLayoutLibrary(7, restored.library!, "1", deps);
    expect(deps.write).toHaveBeenCalledTimes(2);
  });
  it("完整失败回执且退款金额闭合时只准当前批次递增一次", async () => {
    const doc = fixture(), deps = storage(), library: LayoutLibrary = { version: 1, owner: "7", documents: [doc] };
    state.records.set("route-openrouter.json", { state: "failed", response: { status: 503, text: "服务端明确失败" } });
    await writeLayoutLibrary(7, library, "0", deps);
    const changed = structuredClone(library); changed.documents[0].publication!.attempts["0"] = 1;
    await writeLayoutLibrary(7, changed, "1", deps);
    expect((await readLayoutLibrary(7, deps)).library!.documents[0].publication!.attempts["0"]).toBe(1);
    await expect(writeLayoutLibrary(7, changed, "1", deps)).rejects.toThrow("已变化");
  });
  it.each(["pending", "unknown", "received", "malformed"])("上游%s不能因本地退款就重购", async status => {
    const doc = fixture(); state.records.set("route-openrouter-retry-2.json", { state: status });
    await expect(checkKnowledgePublicationRetry(7, doc, 0, 0)).rejects.toThrow("结果尚待核实");
  });
  it("实际退款未闭合、金额缺失、错误账号和原请求均拒绝", async () => {
    const doc = fixture(); state.settled = false;
    await expect(checkKnowledgePublicationRetry(7, doc, 0, 0)).rejects.toThrow("退款未闭合");
    state.settled = true; delete state.job.output.creditsRefunded;
    await expect(checkKnowledgePublicationRetry(7, doc, 0, 0)).rejects.toThrow("退款未闭合");
    state.job.output.creditsRefunded = 12; state.job.userId = "8";
    await expect(checkKnowledgePublicationRetry(7, doc, 0, 0)).rejects.toThrow("未确认失败");
    state.job.userId = "7"; state.job.input.requestId = "other";
    await expect(checkKnowledgePublicationRetry(7, doc, 0, 0)).rejects.toThrow("未确认失败");
  });
  it("不允许跳号、回退、批次错位或一次改多个编号", async () => {
    const doc = fixture();
    const invalidAttempts: Record<string, number>[] = [{ 0: 2 }, { 1: 1 }, { 0: 1, 1: 1 }];
    for (const attempts of invalidAttempts) {
      const next = structuredClone(doc); next.publication!.attempts = attempts;
      await expect(validateKnowledgePublicationRetryTransition(7, doc, next)).rejects.toThrow("不能跳号");
    }
    const before = structuredClone(doc); before.publication!.attempts["0"] = 1;
    await expect(validateKnowledgePublicationRetryTransition(7, before, doc)).rejects.toThrow("不能跳号");
  });
});
