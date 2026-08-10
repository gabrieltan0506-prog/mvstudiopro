import { describe, expect, it } from "vitest";
import { buildSinglePageKnowledgeCardImagePrompt } from "./geminiPlatformCompositeTranslation";

/**
 * 版式必须走出图指令，不能进正文。
 *
 * 用户 2026-08-05 随机选「左右对半对比」跑轻量档，第 1 页整页印成模板说明书：
 * 当时前端把版式块拼在 `scriptContext` 前面，而 `scriptContext` 会被
 * `planKnowledgeCardPages` 逐页切开当正文，提炼稿越短版式块占比越大。
 */
describe("buildSinglePageKnowledgeCardImagePrompt · 版式指令", () => {
  const markdown = [
    "# FDE 全书精华",
    "## 什么是 FDE",
    "现场交付工程师连接客户现场与产品能力。",
    "## 三阶段闭环",
    "现场工程 → 结果验收 → 产品回流。",
  ].join("\n\n");

  it("不传版式时不出现版式段", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, { notePageIndex: 1, notePageTotal: 1 });
    expect(prompt).not.toContain("【版式·仅排版参考");
    expect(prompt).toContain("什么是 FDE");
  });

  it("传版式时给出构图参考，并明令不得把版式文字印到图上", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, {
      notePageIndex: 1,
      notePageTotal: 1,
      infographicTemplateId: "infographic_rival_showdown",
    });
    expect(prompt).toContain("【版式·仅排版参考·不是内容】");
    expect(prompt).toContain("左右对半对比");
    expect(prompt).toContain("严禁");
    // 正文照旧
    expect(prompt).toContain("什么是 FDE");
    expect(prompt).toContain("三阶段闭环");
  });

  it("版式段不把竖版比例带进横版卡片，也不残留 LAYOUT ONLY 前缀", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, {
      notePageIndex: 1,
      notePageTotal: 1,
      infographicTemplateId: "infographic_material_lab",
    });
    expect(prompt).not.toContain("--ar 3:4");
    expect(prompt).not.toContain("LAYOUT ONLY");
    expect(prompt).toContain("忽略版式自带的竖版比例");
  });

  it("版式 id 不存在时静默忽略，不影响出图", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, {
      notePageIndex: 1,
      notePageTotal: 1,
      infographicTemplateId: "no_such_template",
    });
    expect(prompt).not.toContain("【版式·仅排版参考");
    expect(prompt).toContain("什么是 FDE");
  });
});
