import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const state = vi.hoisted(() => ({ row: {} as any, updated: [] as any[], matched: true, dbError: false }));
vi.mock("../db", () => ({ getDb: async () => ({
  select: () => ({ from: () => ({ where: () => ({ limit: async () => { if (state.dbError) throw new Error("test-db-down"); return [state.row]; } }) }) }),
  update: () => ({ set: (values: unknown) => ({ where: (condition: unknown) => {
    state.updated.push({ values, condition });
    return { returning: async () => state.matched ? [{ id: "test-job" }] : [] };
  } }) }),
}) }));
import { beginKnowledgeCardSettlement, requestPlatformJobCancel, markKnowledgeCardSettlementSucceeded } from "./repository";
const cp = { version: 1 as const, fee: 25, receiptModel: "glm-5.3-flash", markdown: "已保存的真实正文", output: { success: true, distilledMarkdown: "已保存的真实正文", pageCount: 4 } };
beforeEach(() => { state.updated = []; state.matched = true; state.dbError = false; state.row = { id: "test-job", type: "platform", userId: "1", status: "running", input: { action: "knowledge_card_distill" }, output: {} }; });
describe("取消与结算同一任务行互斥", () => {
  it("结算CAS包含无取消/无检查点条件，并写完整检查点", async () => {
    expect(await beginKnowledgeCardSettlement("test-job", cp)).toBe("accepted");
    const query = new PgDialect().sqlToQuery(state.updated[0].condition);
    expect(query.sql).toContain("cancelRequestedAt");
    expect(query.sql).toContain("knowledgeCardSettlement");
    expect(query.params).toContain("running");
    const value = new PgDialect().sqlToQuery(state.updated[0].values.output);
    expect(value.params).toContain(JSON.stringify({ knowledgeCardSettlement: cp }));
  });
  it("取消先赢，结算CAS失败且返回取消", async () => {
    state.matched = false; state.row.input.cancelRequestedAt = "test-cancel";
    expect(await beginKnowledgeCardSettlement("test-job", cp)).toBe("cancelled");
  });
  it("结算先赢，不写取消标记", async () => {
    state.row.output = { knowledgeCardSettlement: cp };
    await requestPlatformJobCancel({ jobId: "test-job", userId: "1", actions: ["knowledge_card_distill"], queuedError: "停止" });
    expect(state.updated).toHaveLength(0);
  });
  it("取消更新也排除结算检查点", async () => {
    await requestPlatformJobCancel({ jobId: "test-job", userId: "1", actions: ["knowledge_card_distill"], queuedError: "停止" });
    expect(new PgDialect().sqlToQuery(state.updated[0].condition).sql).toContain("knowledgeCardSettlement");
  });
  it("首读数据库故障抛错，不返回假404", async () => {
    state.dbError = true;
    await expect(requestPlatformJobCancel({ jobId: "test-job", userId: "1", actions: ["knowledge_card_distill"], queuedError: "停止" })).rejects.toThrow("test-db-down");
  });
  it("终态写入失败显式报错；不同稿不能覆盖原稿", async () => {
    state.row.output = { knowledgeCardSettlement: cp }; state.matched = false;
    await expect(markKnowledgeCardSettlementSucceeded("test-job", { ...cp.output, distillFeeCharged: 25 })).rejects.toThrow("未持久化");
    await expect(markKnowledgeCardSettlementSucceeded("test-job", { ...cp.output, distilledMarkdown: "另一份稿" })).rejects.toThrow("不一致");
  });
});
