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
 for (const text of [rewrite,TEMPLATE_REWRITE_QUESTION]) {
  expect(text.startsWith("【模板改写建议】")).toBe(true);
  expect(text).toContain(MANHUA_DIALOGUE_CRAFT_ZH);
  expect(text).toContain("不写回");
 }
});
