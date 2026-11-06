import { beforeEach, describe, expect, it, vi } from "vitest";
const database = vi.hoisted(() => ({ rows: [] as { model: string }[], written: [] as unknown[], available: true }));
vi.mock("../db", () => ({ getDb: async () => database.available ? {
  select: () => ({ from: () => ({ where: async () => database.rows }) }),
  insert: () => ({ values: (value: unknown) => { database.written.push(value); return { onConflictDoNothing: async () => undefined }; } }),
} : null }));
import { quoteKnowledgeCard, assertKnowledgeCardConfirmedPrice, assertKnowledgeCardPageSelection } from "./knowledgeCardPricing";
import { recordKnowledgeCardDistillReceipt } from "./knowledgeCardDistillReceipt";
import { knowledgeCardCreditsForPageIndex, knowledgeCardCreditsForPages } from "../../shared/knowledgeCardPagination";
import { KNOWLEDGE_CARD_DISTILL_MODEL_DEEPSEEK as DS, KNOWLEDGE_CARD_DISTILL_MODEL_GLM as GLM, preserveStoredKnowledgeCardModel, knowledgeCardRecordedModelLabel } from "../../shared/knowledgeCardDistillModels";

beforeEach(() => { database.rows = []; database.written = []; database.available = true; });
describe("手册新价与原账隔离", () => {
  it("标准30/24、优良34/28，跨过第8页仍逐页恰差4积分", () => {
    expect([knowledgeCardCreditsForPageIndex(8, DS), knowledgeCardCreditsForPageIndex(9, DS)]).toEqual([30, 24]);
    expect([knowledgeCardCreditsForPageIndex(8, GLM), knowledgeCardCreditsForPageIndex(9, GLM)]).toEqual([34, 28]);
    for (const pages of [1, 8, 9, 20]) expect(knowledgeCardCreditsForPages(pages, GLM) - knowledgeCardCreditsForPages(pages, DS)).toBe(pages * 4);
  });
  it("新手写稿提交旧模型ID仍按现行价；报价须读取本人账本", async () => {
    const result = await quoteKnowledgeCard(7, "# 正文\n完整内容", "glm-5.3-flash");
    expect(result).toMatchObject({ billingModel: GLM, hasReceipt: false, prices: { full: 34, discount: 28 }, credits: 34 });
  });
  it("旧GLM稿不因升级涨价，新选择也不能冒充重新读档", async () => {
    database.rows = [{ model: "glm-5.3-flash" }];
    const result = await quoteKnowledgeCard(7, "# 旧稿\n正文", DS);
    expect(result).toMatchObject({ billingModel: "glm-5.3-flash", hasReceipt: true, prices: { full: 24, discount: 19 }, credits: 24 });
    expect(assertKnowledgeCardConfirmedPrice(result.billingModel, 9, 19)).toBe(19);
  });
  it("同稿多条历史读档按原价比较，不先映射导致低价账覆盖高价账", async () => {
    database.rows = [{ model: "glm-5.3-flash" }, { model: "deepseek-v4.1-flash" }, { model: "claude-opus-5" }];
    expect((await quoteKnowledgeCard(7, "原稿", GLM)).billingModel).toBe("claude-opus-5");
  });
  it("新结算与旧检查点重放分别保留其确切计费身份", async () => {
    await recordKnowledgeCardDistillReceipt(7, GLM, "新稿");
    await recordKnowledgeCardDistillReceipt(7, "glm-5.3-flash", "原检查点");
    expect(database.written).toMatchObject([{ model: GLM }, { model: "glm-5.3-flash" }]);
  });
  it("报价不符或未确认先拒绝；账本不可读不得回退客户端低价", async () => {
    expect(() => assertKnowledgeCardConfirmedPrice(GLM, 1, 24)).toThrow("未扣费");
    expect(() => assertKnowledgeCardConfirmedPrice(GLM, 1, undefined)).toThrow("未扣费");
    database.available = false;
    await expect(quoteKnowledgeCard(7, "原稿", DS)).rejects.toThrow("receipt unavailable");
  });
});

// 旧队列进入新部署时仍必须按入队时原档结算，新入口已把选择规范化为精确型号。
it("保留已入队旧档位，不把旧GLM任务升成34积分", () => {
  const old = preserveStoredKnowledgeCardModel("glm-5.3-flash", GLM);
  expect(old).toBe("glm-5.3-flash");
  expect(knowledgeCardCreditsForPages(9, old)).toBe(8 * 24 + 19);
  expect(preserveStoredKnowledgeCardModel(GLM, GLM)).toBe(GLM);
  expect(knowledgeCardCreditsForPages(9, GLM)).toBe(8 * 34 + 28);
  expect(preserveStoredKnowledgeCardModel("invalid-model", DS)).toBe(DS);
  expect(knowledgeCardRecordedModelLabel("claude-opus-5")).toBe("原读档模型：claude-opus-5");
  expect(knowledgeCardRecordedModelLabel(GLM)).toContain("GLM 5.3 FlashX");
});

it("拒绝用越界页码领取折扣，以及总页数与实际切片不一致", () => {
  expect(() => assertKnowledgeCardPageSelection("# 单页\n正文", DS, 9, 9)).toThrow("未扣费");
  expect(() => assertKnowledgeCardPageSelection("# 单页\n正文", DS, 1, 2)).toThrow("页码");
  expect(() => assertKnowledgeCardPageSelection("# 单页\n正文", DS, 1, 1)).not.toThrow();
  expect(() => assertKnowledgeCardPageSelection("# 旧稿\n正文", DS)).not.toThrow();
});
