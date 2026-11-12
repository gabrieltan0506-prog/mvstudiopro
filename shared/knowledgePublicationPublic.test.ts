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

describe("排版前篇幅整理未完成的业务提示", () => {
  const timeout = "整册篇幅压缩未完成，超出页不进排版：本批模型调用超过约10分钟上限，判本批失败；已完成内容与各跳回执保留，可只重试未完成部分";
  const expected = "排版前的篇幅整理未完成（处理超时或结果未通过检查），超出的页面暂未进入排版；原稿和已完成部分已保留，可以仅重试未完成部分。";
  it.each([
    timeout,
    "第3组篇幅压缩仍未完成，超出页不进排版：模型输出未完整结束（finish_reason=length） route=glm-evolink https://example.com/x",
  ])("操作层归类与直接抛出都落到具体业务句：%s", reason => {
    // 操作层（askPlatformSkillQa catch）归类后落库与回放。
    const saved = knowledgePublicationFailureMessage(new Error(reason));
    expect(saved).toBe(expected);
    expect(knowledgePublicationFailureMessage(saved)).toBe(saved);
    // 失败任务恢复时重跑再次失败：原因未经归类直接到中间件/流式出口。
    const once = knowledgePublicationPublicError(new Error(reason));
    expect(once).toEqual({ message: expected, retryable: true });
    // 服务端中间件 → 流式出口 → 前台面板，多次过滤保持幂等。
    expect(knowledgePublicationPublicError(new Error(once.message))).toEqual(once);
    expect(knowledgePublicationPublicError(once.message)).toEqual(once);
    expect(once.message).not.toMatch(/请继续已保存的任务|模型|glm|evolink|route|https?:|finish_reason|10分钟/i);
  });
  it("仅超时上限、未写明哪一步时给通用可重试句，不落兜底", () => {
    const r = knowledgePublicationPublicError(new Error("本批模型调用超过约10分钟上限，判本批失败；已完成内容与各跳回执保留，可只重试未完成部分"));
    expect(r).toEqual({ message: "本次整理未完成，已完成的内容和原稿均已保留，可以仅重试未完成部分。", retryable: true });
    expect(knowledgePublicationPublicError(new Error(r.message))).toEqual(r);
  });
  it("回执未闭合仍优先：不可重购", () => {
    const r = knowledgePublicationPublicError(new Error("整册篇幅压缩未完成：原请求回执尚未闭合"));
    expect(r.retryable).toBe(false);
    expect(knowledgePublicationFailureMessage(new Error("整册篇幅压缩未完成：原请求回执尚未闭合"))).toBe(r.message);
  });
});
