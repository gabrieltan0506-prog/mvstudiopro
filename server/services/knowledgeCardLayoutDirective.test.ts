import { describe, expect, it } from "vitest";
import { buildSinglePageKnowledgeCardImagePrompt, resolveKnowledgeCardPageSource } from "./geminiPlatformCompositeTranslation";

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

describe("知识卡正式出图带渲染质感锁（0824 审阅修复）", () => {
  const markdown = ["# 材料工艺", "## 结构", "外壳、机芯与缓冲层的关系。"].join("\n\n");

  it("信息海报版式带 3D 渲染锁", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, {
      notePageIndex: 1,
      notePageTotal: 1,
      infographicTemplateId: "infographic_material_lab",
    });
    expect(prompt).toContain("ambient occlusion");
    expect(prompt).toContain("subsurface scattering");
  });

  it("融合版式带水彩安全版，不带 PBR/SSS", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(markdown, {
      notePageIndex: 1,
      notePageTotal: 1,
      infographicTemplateId: "fusion_coastal_lighthouse",
    });
    expect(prompt).toContain("watercolor ink-bleed edges");
    expect(prompt).not.toContain("subsurface scattering");
  });
});

describe("buildSinglePageKnowledgeCardImagePrompt · 主体位置与参考原页（0908）", () => {
  const md = "# 中医养生主线\n\n## 扶阳操\n- 第一式站桩\n〔参考原页 0123456789abcdef:p41〕\n\n## 早餐\n- 因人施养";

  it("pins landscape 16:9 with the chosen subject side; default left", () => {
    const left = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 1, notePageTotal: 1 });
    expect(left).toContain("LANDSCAPE 16:9");
    expect(left).toContain("LEFT third");
    const center = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 1, notePageTotal: 1, subjectPosition: "center" });
    expect(center).toContain("CENTER the main visual subject");
  });

  it("strips 〔参考原页〕 markers from the printed body and adds the redraw directive only when refs are attached", () => {
    const without = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 1, notePageTotal: 1 });
    expect(without).not.toContain("参考原页 0123456789abcdef");
    expect(without).not.toContain("【原稿参考页·仅借版式结构】");
    expect(without).toContain("第一式站桩");
    const withRefs = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 1, notePageTotal: 1, referencePageCount: 2 });
    expect(withRefs).toContain("【原稿参考页·仅借版式结构】随本次请求附带 2 张");
    expect(withRefs).toContain("不要");
    expect(withRefs).not.toContain("参考原页 0123456789abcdef");
  });

  it("keeps the old rich visual spec (楷书金橙标题 / 4–6 模块 / 勾选条) that produced the accepted samples", () => {
    const prompt = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 1, notePageTotal: 5 });
    expect(prompt).toContain("书法楷书");
    expect(prompt).toContain("4–6 个模块");
    expect(prompt).toContain("（第 1/5 页）");
    expect(prompt).toContain("Wide 16:9 landscape");
  });
});

describe("resolveKnowledgeCardPageSource · 路由与出图共用切片", () => {
  const md = Array.from({ length: 8 }, (_, i) => `## 第${i + 1}节\n${"要点内容。".repeat(40)}`).join("\n\n");
  it("page mode slice equals what the prompt prints; upper/lower compat maps to halves", () => {
    const p2 = resolveKnowledgeCardPageSource(md, { notePageIndex: 2, notePageTotal: 4 });
    expect(p2.mode).toBe("page");
    const prompt = buildSinglePageKnowledgeCardImagePrompt(md, { notePageIndex: 2, notePageTotal: 4 });
    expect(prompt).toContain(p2.source.slice(0, 60));
    const upper = resolveKnowledgeCardPageSource(md, { notePart: "upper" });
    const lower = resolveKnowledgeCardPageSource(md, { notePart: "lower" });
    expect(upper.mode).toBe("part");
    expect(upper.source).not.toBe(lower.source);
    expect(buildSinglePageKnowledgeCardImagePrompt(md, { notePart: "lower" })).toContain(lower.source.slice(0, 60));
  });
});
