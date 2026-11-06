import { describe, it, expect, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
const state = vi.hoisted(() => ({ patch: null as any, where: null as any }));
vi.mock("../db", () => ({ getDb: async () => ({ update: () => ({ set: (patch: any) => { state.patch = patch; return { where: async (condition: any) => { state.where = condition; } }; } }) }) }));
import { markKnowledgeImageFailed } from "./knowledgeImageFailure";
import { knowledgeImageMayRetry } from "../../shared/knowledgeImageRetry";
describe("图片失败与结算证据原子保存", () => {
  it("未知失败仍不可重购，写入受owner与非成功状态保护且保留已有output", async () => {
    await markKnowledgeImageFailed("job", "7", "上游待核", "pending");
    const dialect = new PgDialect();
    const output = dialect.sqlToQuery(state.patch.output), condition = dialect.sqlToQuery(state.where);
    expect(state.patch.status).toBe("failed");
    expect(output.sql).toContain("coalesce");
    expect(output.params.some((p: unknown) => typeof p === "string" && p.includes('"reason":"pending"'))).toBe(true);
    expect(condition.sql).toContain("<>"); expect(condition.params).toEqual(["job", "7", "succeeded"]);
    expect(knowledgeImageMayRetry({ status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "pending" } } })).toBe(false);
    expect(knowledgeImageMayRetry({ status: "failed", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } })).toBe(true);
    expect(knowledgeImageMayRetry({ status: "succeeded", output: { knowledgeImageRetry: { version: 1, reason: "refunded" } } })).toBe(false);
  });
});
