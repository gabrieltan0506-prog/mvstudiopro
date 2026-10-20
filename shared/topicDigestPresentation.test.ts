import { expect, it } from "vitest";
import { buildTopicReadingComparison, groupTopicsForReading, classifyTopicForReading } from "./topicDigestPresentation";
import real from "../client/src/lib/fixtures/topicDigestRealDrafts.json";
it("真实三稿完整保留24个选题和原文，分类可追溯，组内原顺序不变", () => {
  const before = JSON.stringify(real);
  const result = buildTopicReadingComparison(real);
  expect(result.sections.map(s => s.rows.length)).toEqual([8,8,8]);
  expect(result.sections.map(s => s.unavailable)).toEqual([false,false,false]);
  const final = groupTopicsForReading(result.sections[2].rows);
  expect(final.map(g => [g.group, g.rows.length])).toEqual([["工具与流程",2],["选题与素材",2],["写作与制作",3],["发布与反馈",1]]);
  for (const section of result.sections) {
    const original = real[section.key].raw.topics;
    for (const row of section.rows) { expect(row.angle).toBe(original[row.originalIndex-1].angle); expect(row.outline).toEqual(original[row.originalIndex-1].outline); }
    expect(groupTopicsForReading(section.rows).flatMap(g=>g.rows)).toHaveLength(8);
  }
  expect(JSON.stringify(real)).toBe(before);
});
it("付费只显示已投递题与对应原稿，免费不暴露另一原稿及整合稿", () => {
  const one = real.integrated.raw.topics[0];
  const paid = buildTopicReadingComparison(real,{ method:"dual",topics:[{...one,id:"topic-1"}] as any });
  expect(paid.sections.map(s=>s.rows.length)).toEqual([1,1,1]);
  expect(paid.sections[1].rows[0].key).toBe("glm:6");
  expect(paid.mergeNotes).toEqual([]);
  const free = buildTopicReadingComparison(real,{method:"deepseek",topics:[{...real.deepseek.raw.topics[1],id:"topic-2"}] as any});
  expect(free.sections).toHaveLength(1); expect(free.sections[0].rows.map(r=>r.key)).toEqual(["deepseek:2"]);
});
it("历史缺稿明确缺失，不以其他原稿或空JSON冒充；未知分类不硬套", () => {
  expect(buildTopicReadingComparison(null).sections.every(s=>s.unavailable)).toBe(true);
  expect(classifyTopicForReading({title:"树叶落下来",tags:["自然"]}).group).toBe("其他主题");
});
