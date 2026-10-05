import { describe, expect, it } from "vitest";
import { advisorRewriteCandidateSchema, advisorRewriteResponseSchema, replaceManhuaEpisodeStoryText, splitManhuaEpisodeStoryText, validateAdvisorRewriteBody } from "./manhuaAdvisorRewrite";

const technical = "### 五至六段可拍表\n#### 段01\n意图：逼问身份\n对白：甲：你是谁？\n表演：盯住来人\n光影运镜：推近";
describe("每集剧情正文不设人工字数限制", () => {
  it("很长原稿允许有意缩写，很长新稿及钩子不被schema裁切", () => {
    const originalBody = "旧剧情".repeat(4000);
    expect(() => validateAdvisorRewriteBody(originalBody, "她离开。" )).not.toThrow();
    const body = "完整剧情对白".repeat(3000), endHook = "待续".repeat(3000);
    expect(advisorRewriteResponseSchema.parse({ kind: "template-rewrite", body, endHook, changes: ["扩展剧情"] }).body).toBe(body);
    expect(advisorRewriteCandidateSchema.parse({ episodeIndex: 1, originalBody, rewrittenBody: body, originalEndHook: endHook, endHook, changes: ["扩展剧情"] }).rewrittenBody).toBe(body);
  });
  it("空正文与错误对象仍拒绝，不把短正文认作截断", () => {
    expect(() => validateAdvisorRewriteBody("旧稿", " ")).toThrow();
    expect(() => validateAdvisorRewriteBody("旧稿", "[object Object]")).toThrow();
    expect(() => validateAdvisorRewriteBody("旧稿", "新稿")).not.toThrow();
  });
});

describe("剧情与技术材料分离", () => {
  it("只取明确技术章节，后续普通剧情继续保留", () => {
    const body = `### 场次 E1-S1\n甲握住门闩。\n\n${technical}\n\n### 尾声\n乙转身离开。`;
    const result = splitManhuaEpisodeStoryText(body);
    expect(result.technicalSections).toEqual([technical]);
    expect(result.story).toContain("甲握住门闩。");
    expect(result.story).toContain("### 尾声\n乙转身离开。");
    expect(result.story).not.toContain("段01");
    const rewritten = replaceManhuaEpisodeStoryText(body, "### 场次 E1-S1\n甲打开门，乙进入屋内。");
    expect(rewritten).toContain(technical);
    expect(rewritten.match(/五至六段可拍表/g)).toHaveLength(1);
  });
  it("普通段落及场次不会猜成技术表，无标题秒位表明确分离", () => {
    const body = "## 第一段\n甲低声说：别怕。\n\n### 场次 E1-S1\n乙望向江心。";
    expect(splitManhuaEpisodeStoryText(body)).toEqual({ story: body, technicalSections: [] });
    const table = "| 镜号 | 秒位 | 景别/运镜 | 画面 | 对白 |\n|---|---|---|---|---|\n| 1 | 0-4秒 | 近景 | 开门 | 甲：进来 |";
    expect(splitManhuaEpisodeStoryText(`${body}\n\n${table}\n\n故事继续。`)).toEqual({ story: `${body}\n\n\n故事继续。`, technicalSections: [table] });
  });
  it("新增或改写技术材料显式拒绝，不悄悄丢弃", () => {
    expect(() => replaceManhuaEpisodeStoryText(`旧剧情\n${technical}`, `新剧情\n${technical.replace("推近", "拉远")}`)).toThrow("技术分镜表");
    expect(replaceManhuaEpisodeStoryText(`旧剧情\n${technical}`, `新剧情\n${technical}`)).toBe(`新剧情\n\n${technical}`);
  });
});
