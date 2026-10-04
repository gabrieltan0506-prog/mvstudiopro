import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildTemplateAdviceQuestion } from "./manhuaTemplateAdvice";
import { findMentionedTemplates } from "./manhuaCreativeAdvisorContext";
import ManhuaTemplatePicker, {
  filterTemplateChoices,
  templateChoiceLabel,
} from "@/components/canvas/ManhuaTemplatePicker";
import type { PublicManhuaViralTemplateCard } from "@shared/manhuaViralTemplateBank";

const cards: PublicManhuaViralTemplateCard[] = ["反应与停顿", "声音牵引"].map(
  (style, index) => ({
    publicId: `mt_a12${index}`,
    methodBrief: {
      title: style,
      highlights: [`${style}：火光与门外脚步共同制造逼近感。`],
      useWhen: "适合受限空间里的对峙。",
    },
    nameZh: `紧张·创作模板 A12${index}`,
    laneZh: "悬疑权谋",
    classificationTagsZh: ["紧张"],
    beatCount: 200 + index,
    densityLevel: "standard",
    featureZh: "特色",
    introZh: "简介",
    storyPreview: {
      storyTypeZh: "身份与立威",
      premiseZh: `故事梗概${index}`,
      openingZh: `开篇${index}`,
      earlyProgressionZh: "冲突刚展开",
      presentationTagsZh: [style],
    },
  })
);

describe("模板选择整理", () => {
  it("所选编号进入顾问真实问题并可从回答回到同卡试写，长码不误匹配", () => {
    const question = buildTemplateAdviceQuestion(cards[0]!);
    expect(question).toContain("模板编号 A120");
    expect(question).toContain("当前集真实剧本");
    expect(question).toContain("不生成媒体");
    expect(findMentionedTemplates("建议用模板编号 A120", cards)).toEqual([
      cards[0],
    ]);
    expect(findMentionedTemplates("建议用模板编号 A1200", cards)).toEqual([]);
  });
  it("相同标签不合并手法不同的卡，只折叠相同公开ID", () => {
    expect(
      filterTemplateChoices([...cards, cards[0]!], "紧张", "")
    ).toHaveLength(2);
    expect(
      filterTemplateChoices(cards, "声音", "身份与立威").map(
        card => card.publicId
      )
    ).toEqual(["mt_a121"]);
    expect(templateChoiceLabel(cards[0]!)).toContain("反应与停顿");
  });
  it("列表直接呈现具体视听方法，不再推销故事套路", () => {
    const html = renderToStaticMarkup(
      createElement(ManhuaTemplatePicker, {
        cards,
        value: "mt_a120",
        disabled: false,
        onChange: () => {},
        onWrite: () => {},
        onAskAdvisor: () => {},
      })
    );
    expect(html).not.toContain("故事梗概0");
    expect(html).toContain("火光与门外脚步");
    expect(html).not.toContain("故事梗概1");
    expect(html).toContain("试写与正式应用");
    expect(html).not.toContain("200 拍");
    expect(html).toContain("选好了，我自己写");
    expect(html).toContain("把编号交给创作顾问");
  });
});

it("按创作方法筛选，不附加作品形式条件", () => {
  const augmented = cards.map(c => ({
    ...c,
    craft: {
      version: 1 as const,
      features: [
        {
          id: "music-turn" as const,
          dimension: "sound" as const,
          label: "音乐推动剧情转折",
        },
      ],
    },
  }));
  expect(
    filterTemplateChoices(augmented, "音乐", "", {
      dimension: "sound",
      feature: "music-turn",
    })
  ).toHaveLength(2);
  expect(
    filterTemplateChoices(augmented, "", "", { dimension: "dialogue" })
  ).toEqual([]);
});
