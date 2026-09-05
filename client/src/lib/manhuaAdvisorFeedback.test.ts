import { describe, expect, it } from "vitest";
import { formatManhuaAdvisorContextIssue, formatManhuaAdvisorError } from "./manhuaAdvisorFeedback";

describe("顾问公共错误提示", () => {
  it("容量错误显示业务字段和真实上限，不输出 schema 路径", () => {
    expect(formatManhuaAdvisorContextIssue({ path: ["episodeBody"], message: "本集正文超过 24000 字符上限" }))
      .toBe("本集正文超过 24000 字符，本次没有发送，也不会自动截断。");
    expect(formatManhuaAdvisorContextIssue({ path: ["history", 1, "content"], message: "不得包含URL" }))
      .toBe("最近对话含链接或敏感内容，请移除后再咨询。");
  });
  it("保持失败分类，不泄漏上游名称、端点或原始异常", () => {
    const cases = [
      ["OpenRouter fetch failed https://test.invalid", "连接中断或超时"],
      ["Gemini HTTP 429", "当前繁忙"],
      ["Credits 不足，需要 8 点", "积分不足"],
      ["UNAUTHORIZED", "重新登录"],
      ["OpenAI raw internal failure", "未能返回有效答复"],
    ];
    for (const [raw, expected] of cases) {
      const result = formatManhuaAdvisorError(raw!);
      expect(result).toContain(expected);
      expect(result).not.toMatch(/OpenRouter|Gemini|OpenAI|Credits|https:\/\//);
    }
  });
});
