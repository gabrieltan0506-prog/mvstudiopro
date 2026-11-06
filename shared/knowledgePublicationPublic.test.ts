import { describe, it, expect } from "vitest";
import { knowledgePublicationFailureMessage, knowledgePublicationPublicError } from "./knowledgePublicationPublic";

describe("图文合同失败的业务提示", () => {
  it.each([
    "第1页缺少实际配图审校，未采用结果",
    "第1页的图文疑点没有说明，未采用结果",
    "跨页核对返回未知页号，未采用",
    "输出合同不符：invalid_type private-id secret-key",
  ])("%s经保存和恢复仍可重试且不泄露内部内容", reason => {
    const saved = knowledgePublicationFailureMessage(new Error(reason));
    expect(saved).toBe("本次整理返回的格式不完整或与原稿不符，未采用错误内容；原稿和已完成部分已保留。");
    expect(knowledgePublicationFailureMessage(saved)).toBe(saved);
    expect(knowledgePublicationPublicError(saved)).toEqual({ message: saved, retryable: true });
    expect(saved).not.toMatch(/private-id|secret-key|invalid_type/);
    expect(knowledgePublicationPublicError(`ADVISOR_OPERATION_REFUND_PENDING ${saved}`).retryable).toBe(false);
  });
});
