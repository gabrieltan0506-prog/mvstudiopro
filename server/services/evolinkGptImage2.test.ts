import { describe, expect, it } from "vitest";
import { isEvolinkModerationFailure } from "./evolinkGptImage2";

describe("isEvolinkModerationFailure", () => {
  it("认得真正的内容审核", () => {
    expect(isEvolinkModerationFailure("Your prompt was rejected by moderation")).toBe(true);
    expect(isEvolinkModerationFailure("content policy violation")).toBe(true);
    expect(isEvolinkModerationFailure("图片含敏感内容")).toBe(true);
  });

  /**
   * 2026-08-05 线上：OpenAI 余额耗尽 + OpenRouter 403 TOS，两条都被标成「内容审核拦截」，
   * 提示用户改文案，还触发了「命中审核就快速失败」的短路。
   */
  it("余额与配额问题不算审核", () => {
    expect(
      isEvolinkModerationFailure(
        "OpenAI generations HTTP 429: You have no credits remaining. Add credits to continue",
      ),
    ).toBe(false);
    expect(isEvolinkModerationFailure("insufficient quota")).toBe(false);
    expect(isEvolinkModerationFailure("billing hard limit reached")).toBe(false);
  });

  it("provider 封禁不算审核（原文含 violation，最容易误判）", () => {
    expect(
      isEvolinkModerationFailure(
        "OpenRouter images HTTP 403: The request is prohibited due to a violation of provider Terms Of Service.",
      ),
    ).toBe(false);
  });

  it("空消息不算", () => {
    expect(isEvolinkModerationFailure(undefined)).toBe(false);
    expect(isEvolinkModerationFailure("")).toBe(false);
  });
});
