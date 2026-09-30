import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTemplateAdviceQuestion } from "./manhuaTemplateAdvice";
import { findMentionedTemplates } from "./manhuaCreativeAdvisorContext";
import ManhuaTemplatePicker, { filterTemplateChoices, templateChoiceLabel } from "@/components/canvas/ManhuaTemplatePicker";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

const cards: PublicManhuaViralTemplateCard[] = ["反应与停顿", "声音牵引"].map((style, index) => ({
  publicId: `mt_a12${index}`, nameZh: `紧张·创作模板 A12${index}`, laneZh: "悬疑权谋", classificationTagsZh: ["紧张"], beatCount: 200 + index, densityLevel: "standard", featureZh: "特色", introZh: "简介",
  storyPreview: { storyTypeZh: "身份与立威", premiseZh: `故事梗概${index}`, openingZh: `开篇${index}`, earlyProgressionZh: "冲突刚展开", presentationTagsZh: [style] },
}));

describe("模板选择整理", () => {
  it("所选编号进入顾问真实问题并可从回答回到同卡试写，长码不误匹配", () => {
    const question = buildTemplateAdviceQuestion(cards[0]!);
    expect(question).toContain("模板编号 A120");
    expect(question).toContain("当前集真实剧本");
    expect(question).toContain("不生成媒体");
    expect(findMentionedTemplates("建议用模板编号 A120", cards)).toEqual([cards[0]]);
    expect(findMentionedTemplates("建议用模板编号 A1200", cards)).toEqual([]);
  });
  it("相同标签不合并手法不同的卡，只折叠相同公开ID", () => {
    expect(filterTemplateChoices([...cards, cards[0]!], "紧张", "")).toHaveLength(2);
    expect(filterTemplateChoices(cards, "声音", "身份与立威").map(card => card.publicId)).toEqual(["mt_a121"]);
    expect(templateChoiceLabel(cards[0]!)).toContain("反应与停顿");
  });
  it("列表只展开当前选定大纲，另一份不被隐藏在DOM中", () => {
    const html = renderToStaticMarkup(createElement(ManhuaTemplatePicker, { cards, value: "mt_a120", disabled: false, onChange: () => {}, onWrite: () => {}, onAskAdvisor: () => {} }));
    expect(html).toContain("故事梗概0");
    expect(html).not.toContain("故事梗概1");
    expect(html).toContain("试写与正式应用");
    expect(html).not.toContain("200 拍");
    expect(html).toContain("选好了，我自己写");
    expect(html).toContain("把编号交给创作顾问");
  });
});
