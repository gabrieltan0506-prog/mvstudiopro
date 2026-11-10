import { expect, it } from "vitest";
import { buildManhuaWriterExpandPrompt } from "./manhuaWriterRoom";
import { MANHUA_DIALOGUE_CRAFT_ZH } from "./manhuaDialogueCraft";
import { buildTemplateRewriteQuestion, TEMPLATE_REWRITE_QUESTION } from "../client/src/lib/manhuaAdvisorTemplates";
it("初稿与所选模板改写都接收自然对白要求，不再机械凑三句", () => {
 const prompt = buildManhuaWriterExpandPrompt({topic:"雨夜护送",brief:"保留人物动机",episodeCount:3,videoModel:"seedance-2.5"});
 expect(prompt).toContain(MANHUA_DIALOGUE_CRAFT_ZH);
 expect(prompt).not.toContain("至少 3 句");
 expect(prompt).not.toContain("对白不足 3 句");
 const rewrite = buildTemplateRewriteQuestion({publicId:"test",reason:"冲突",changes:["调整顺序"],preserve:"身份"});
 expect(rewrite.startsWith("【模板改写建议】")).toBe(true);
 expect(rewrite).toContain(MANHUA_DIALOGUE_CRAFT_ZH);
 expect(rewrite).toContain("不写回");
 // 1004 起 TEMPLATE_REWRITE_QUESTION 只是聊天里显示的简短标记；实际发给顾问的是上面的完整问题。
 expect(TEMPLATE_REWRITE_QUESTION.startsWith("【模板改写建议】")).toBe(true);
});
