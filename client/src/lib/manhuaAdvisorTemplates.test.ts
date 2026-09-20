import { describe, expect, it } from "vitest";
import { buildTemplatePlanQuestion, parseAdvisorTemplatePlans, parseAdvisorRewrite } from "./manhuaAdvisorTemplates";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";
const templates = ["a", "b", "c"].map(publicId => ({ publicId, nameZh: `模板${publicId}`, featureZh: "冲突递进", introZh: "" })) as PublicManhuaViralTemplateCard[];
const plans = templates.map(t => ({ publicId: t.publicId, reason: "主角需要逐步揭开身份", changes: ["提前铺设身份线索", "结尾反转身份"], preserve: "原人物及动机" }));
describe("顾问模板结构化结果", () => {
  it("只允许3—4个真实且不同模板，拒绝幻觉ID、重复和不完整结果", () => {
    expect(parseAdvisorTemplatePlans(JSON.stringify({ kind: "template-plans", plans }), templates)).toHaveLength(3);
    for (const invalid of [[...plans.slice(0, 2)], [plans[0], plans[0], plans[2]], [...plans.slice(0, 2), { ...plans[2], publicId: "invented" }]]) {
      expect(parseAdvisorTemplatePlans(JSON.stringify({ kind: "template-plans", plans: invalid }), templates)).toEqual([]);
    }
    expect(parseAdvisorTemplatePlans("这里有一些建议", templates)).toEqual([]);
  });
  it("推荐提示词包含真实ID并拒绝不足3个候选", () => {
    expect(buildTemplatePlanQuestion(templates)).toContain('"publicId":"a"');
    expect(() => buildTemplatePlanQuestion(templates.slice(0, 2))).toThrow("不足3个");
  });
  it("改写保留请求时原稿及集数，拒绝截断JSON、空正文、原样正文和超长原稿", () => {
    const body = "主角走入船舱，看见敌人手中熟悉的信物。她藏起惊讶，压低声音询问来意；对方没有回答，却将剑指向门外。";
    const answer = JSON.stringify({ kind: "template-rewrite", body, changes: ["前置身份悬念"] });
    expect(parseAdvisorRewrite(answer, 2, "旧稿原文")).toMatchObject({ episodeIndex: 2, originalBody: "旧稿原文", rewrittenBody: body });
    expect(() => parseAdvisorRewrite(answer.slice(0, -2), 2, "旧稿")).toThrow();
    expect(() => parseAdvisorRewrite(answer, 2, body)).toThrow("相同");
    expect(() => parseAdvisorRewrite(answer, 2, "旧".repeat(8001))).toThrow();
    expect(() => parseAdvisorRewrite('{"kind":"template-rewrite","body":"","changes":["改动"]}', 2, "旧稿")).toThrow();
  });
});
