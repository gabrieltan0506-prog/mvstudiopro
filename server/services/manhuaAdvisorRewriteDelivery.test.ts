import { expect, it, vi } from "vitest";
import { parseAskJson, buildManhuaCreativeAdvisorLlmMessages } from "./platformSkillQa";
import { parseAdvisorRewrite } from "../../client/src/lib/manhuaAdvisorTemplates";
import { validateAdvisorRewriteBody, TEMPLATE_REWRITE_MARKER } from "../../shared/manhuaAdvisorRewrite";
import { buildTemplateAdviceQuestion } from "../../client/src/lib/manhuaTemplateAdvice";
import type { PublicManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
const body = "### 场次 E1-S1\n场景：夜雨中的文书库，灯光从书架边缘投下狭长的影子。沈昀把卷宗压回袖口，望向门边。周慎停下擦手的动作：你找的那册，今早已经有人来借了。沈昀没有接话，先看了看桌上未干的墨迹。";
const candidate = { kind: "template-rewrite", body, changes: ["用墨迹与停顿承接试探，使光线和动作服务人物关系"] };
it.each([candidate, { answer: candidate }, { answer: JSON.stringify(candidate) }])("对象、字符串与直接返回的优化稿均保留正文，不变成object_object：%j", value => {
  const result = parseAskJson(JSON.stringify(value));
  expect(parseAdvisorRewrite(result.answer, 1, "旧稿：沈昀进门询问借阅记录。").rewrittenBody).toBe(body);
});
it.each([{ answer: { unknown: "不可采用" } }, { answer: [candidate] }, { answer: "[object Object]" }, { answer: "object_object" }])("拒绝任意对象与错误占位：%j", value => {
  expect(() => parseAskJson(JSON.stringify(value))).toThrow();
});
it("正文不按长度比例拒收，仍验证原场次与非空内容", () => {
  expect(() => validateAdvisorRewriteBody(body.repeat(8), body)).not.toThrow();
  expect(() => validateAdvisorRewriteBody(body, body.replace('E1-S1', 'E1-S2'))).toThrow("场次");
  expect(() => validateAdvisorRewriteBody(body, body + "门外的脚步忽然停住。")).not.toThrow();
});
it("模板入口直接请求整集改稿，专用交付包含灯光场景与时序，不交空泛报告", () => {
  const question = buildTemplateAdviceQuestion({ publicId: "mt_1e50", nameZh: "方法" } as PublicManhuaViralTemplateCard);
  expect(question).toContain("模板编号 1E50"); expect(question).toContain(TEMPLATE_REWRITE_MARKER);
  const messages = buildManhuaCreativeAdvisorLlmMessages({ question, rawQuestion: question, templateReference: "已审核方法：以物件变化交代人物关系", context: { seriesTitle: "测试", episodeIndex: 1, episodeTitle: "库房", stage: "outline", videoModel: "未选择", writerConfirmed: false, episodeBody: body, assetSummary: "", shotSummary: "", blockers: [] } });
  expect(messages[0].content).toContain("灯光色彩"); expect(messages[0].content).toContain("明晚会面");
  expect(messages[0].content).toContain("不交分析报告"); expect(messages[1].content).toContain(body.replace(/\n/g,'\\n'));
  expect(messages[1].content).toContain("已审核方法");
});
