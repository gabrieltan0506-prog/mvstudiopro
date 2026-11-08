import { describe, expect, it } from "vitest";
import { compileKnowledgeEditions } from "./knowledgeCardEdition";
import { knowledgeEditionImagePlan, planKnowledgeCardPages, knowledgeCardCreditsForPages } from "./knowledgeCardPagination";
import { synchronizedKnowledgeCardSource } from "./knowledgeCardEditableLayout";
import {
  KNOWLEDGE_TOPIC_IMAGE_CAP,
  KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS,
  partitionKnowledgeTopics,
} from "./knowledgeTopicImagePlan";

const sentence = (i: number, j: number) => `第${i}节第${j}句讲述一项具体史实与它的来龙去脉。`;
const section = (i: number, sentences: number) => ({
  headline: `小节${i}`,
  body: [
    Array.from({ length: Math.ceil(sentences / 2) }, (_, j) => sentence(i, j)).join(""),
    `| 项目 | 内容 |\n| --- | --- |\n${Array.from({ length: 4 }, (_, r) => `| 条目${i}-${r} | 说明${i}-${r} |`).join("\n")}`,
    Array.from({ length: Math.floor(sentences / 2) }, (_, j) => sentence(i, 100 + j)).join(""),
  ].join("\n\n"),
  priority: (i % 6 === 0 ? "primary" : "secondary") as "primary" | "secondary",
});
// 约 200 节、7 万余字的整本书（敦煌完整版量级）
const book = compileKnowledgeEditions("整本书", Array.from({ length: 200 }, (_, i) => section(i, 8 + (i % 7) * 3)));

describe("主题出图：图数按主题定、图内≤1200字、其余进内文", () => {
  it("整本书完整版不超过16张图，精华版不超过8张，每张图≤1200字", () => {
    for (const level of ["full", "concise"] as const) {
      const plan = knowledgeEditionImagePlan(book[level])!;
      expect(plan.images.length).toBeGreaterThan(0);
      expect(plan.images.length).toBeLessThanOrEqual(KNOWLEDGE_TOPIC_IMAGE_CAP[level]);
      for (const image of plan.images) expect(image.body.length).toBeLessThanOrEqual(KNOWLEDGE_TOPIC_IMAGE_MAX_CHARS);
      expect(plan.readingChars).toBeGreaterThan(plan.images.length * 1000);
    }
    expect(knowledgeEditionImagePlan(book.full)!.images.length).toBe(16);
  });

  it("报价按主题图张数计，与出图分页一致", () => {
    const plan = planKnowledgeCardPages(book.full, "glm-5.3-flashx");
    expect(plan.pageCount).toBe(16);
    expect(plan.credits).toBe(knowledgeCardCreditsForPages(16, "glm-5.3-flashx"));
    expect(plan.pages).toEqual(knowledgeEditionImagePlan(book.full)!.images.map(i => i.body));
  });

  it("图与内文按原文切分、互不重复且不丢句", () => {
    const plan = knowledgeEditionImagePlan(book.full)!;
    const image = plan.images.map(i => i.body).join("\n");
    const reading = plan.images.map(i => i.overflow).join("\n");
    for (let i = 0; i < 200; i++) for (let j = 0; j < 3; j++) {
      const s = sentence(i, j);
      const inImage = image.includes(s), inReading = reading.includes(s);
      expect(inImage || inReading).toBe(true);
      expect(inImage && inReading).toBe(false);
    }
    // 表格行不丢，内文续表补回表头
    for (let i = 0; i < 200; i += 37) expect(image.includes(`| 条目${i}-3 |`) || reading.includes(`| 条目${i}-3 |`)).toBe(true);
  });

  it("相邻小节按篇幅合并：短文少图，不按字数切出碎图", () => {
    const short = compileKnowledgeEditions("短文", Array.from({ length: 5 }, (_, i) => ({ headline: `节${i}`, body: sentence(i, 0).repeat(12), priority: "primary" as const })));
    const plan = knowledgeEditionImagePlan(short.full)!;
    expect(plan.images.length).toBeLessThan(5);
    expect(plan.images.flatMap(i => i.headlines)).toEqual(["节0", "节1", "节2", "节3", "节4"]);
  });

  it("连续划分保持原顺序且尽量均衡", () => {
    const groups = partitionKnowledgeTopics([5, 5, 5, 5, 20, 1, 1], 3);
    expect(groups.flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
    expect(groups).toHaveLength(3);
    expect(groups[1]).toEqual([4]);
  });

  it("小节过多时图内只展开最多8节要点，其余列名、全文进内文", () => {
    const plan = knowledgeEditionImagePlan(book.full)!;
    const crowded = plan.images.filter(i => i.headlines.length > 8);
    expect(crowded.length).toBeGreaterThan(0);
    for (const image of plan.images) {
      expect((image.body.match(/^### /gm) || []).length).toBeLessThanOrEqual(8);
      if (image.headlines.length > 8) expect(image.body).toContain("本主题另含：");
    }
  });

  it("排版：每张主题图下方带图外细节（不单图独占），文字模块并入相关主题", () => {
    const plan = knowledgeEditionImagePlan(book.full)!;
    const source = synchronizedKnowledgeCardSource({
      owner: "1", sourceId: "s", fullMarkdown: book.full, illustrationMarkdown: book.full, detailLevel: "full",
      imageJobIds: plan.images.map((_, i) => `job-${i}`),
    });
    expect(source.pages).toHaveLength(16);
    expect(source.pages!.every(p => p.knowledgeRole === "illustration" && (p.supplement || "").length > 0)).toBe(true);
    source.pages!.forEach((page, i) => { if (plan.images[i]!.overflow) expect(page.supplement!.startsWith(plan.images[i]!.overflow)).toBe(true); });
  });

  it("模型照抄字段名的占位标题不采用，回退机械标题与原小节标题", () => {
    const titled = book.full.replace(/^(<!-- knowledge-edition:v2:full -->\n)/, (m) => {
      const plan = knowledgeEditionImagePlan(book.full)!;
      const map = Object.fromEntries(plan.images.map(i => [i.headlines.join("｜"), { image: "图片标题", reading: "图下内文标题", sections: Object.fromEntries(i.headlines.map(h => [h, "该节内文小标题"])) }]));
      return `${m}<!-- knowledge-topic-titles:v1 ${JSON.stringify(map)} -->\n`;
    });
    const plan = knowledgeEditionImagePlan(titled)!;
    expect(plan.images.every(i => i.title !== "图片标题" && i.readingTitle !== "图下内文标题")).toBe(true);
    expect(plan.images[0]!.title).toMatch(/（等\d+节）$/);
    expect(planKnowledgeCardPages(titled).pages.join("")).not.toContain("该节内文小标题");
  });
});
