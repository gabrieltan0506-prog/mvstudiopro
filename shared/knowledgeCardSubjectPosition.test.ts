import { describe, expect, it } from "vitest";
import {
  resolveKnowledgeCardSubjectPosition,
  knowledgeCardLandscapeTemplatePrompt,
  buildKnowledgeCardSubjectPositionPrompt,
} from "./knowledgeCardSubjectPosition";
import { INFOGRAPHIC_NOTE_TEMPLATES } from "./infographicNoteTemplates";

describe("知识卡主体位置与横版模板契约", () => {
  it("仅省略字段默认左侧，显式无效值拒绝而不静默回退", () => {
    expect(resolveKnowledgeCardSubjectPosition()).toBe("left");
    expect(resolveKnowledgeCardSubjectPosition("left")).toBe("left");
    expect(resolveKnowledgeCardSubjectPosition("center")).toBe("center");
    for (const value of [
      null,
      "",
      "right",
      "LEFT",
      "center ",
      " center",
      0,
      false,
      [],
      {},
      new String("left"),
    ])
      expect(() => resolveKnowledgeCardSubjectPosition(value)).toThrow();
  });
  it("两种主体位置都锁横16:9，分别明确左右文字或两侧文字，不改变画幅", () => {
    const left = buildKnowledgeCardSubjectPositionPrompt("left");
    const center = buildKnowledgeCardSubjectPositionPrompt("center");
    expect(left).toContain("LEFT third");
    expect(left).toContain("RIGHT two thirds");
    expect(center).toContain("CENTER the main visual subject");
    expect(center).toContain("BOTH SIDES");
    expect(center).not.toContain("LEFT third");
    for (const prompt of [left, center]) {
      expect(prompt).toContain("LANDSCAPE 16:9");
      expect(prompt).toContain("覆盖模板自带的主体位置");
      expect(prompt).not.toMatch(
        /3\s*[:：]\s*4|\bvertical\s+(infographic|poster|canvas|layout|format|orientation)\b|portrait orientation/i
      );
    }
    expect(buildKnowledgeCardSubjectPositionPrompt()).toBe(left);
    expect(() => buildKnowledgeCardSubjectPositionPrompt("right")).toThrow();
  });
  it("转换宽高比变体及英文方向，只修改知识卡消费的副本", () => {
    const source =
      "3 : 4 / 3：4 VERTICAL infographic; portrait orientation; Portrait canvas; portrait layout; portrait format; subject portrait face";
    const transformed = knowledgeCardLandscapeTemplatePrompt(source);
    expect(transformed).not.toMatch(
      /3\s*[:：]\s*4|\bvertical\s+(infographic|poster|canvas|layout|format|orientation)\b|portrait (orientation|canvas|layout|format)/i
    );
    expect(transformed).toContain("landscape infographic");
    expect(transformed).toContain("landscape orientation");
    expect(transformed).toContain("subject portrait face");
    expect(source).toContain("VERTICAL");
    expect(source).toContain("3 : 4");
    expect(knowledgeCardLandscapeTemplatePrompt(transformed)).toBe(transformed);
  });
  it("遍历所有真实知识卡模板，消费副本无旧竖版比例，原模板完全不变", () => {
    const original = JSON.stringify(INFOGRAPHIC_NOTE_TEMPLATES);
    expect(INFOGRAPHIC_NOTE_TEMPLATES.length).toBeGreaterThan(0);
    for (const template of INFOGRAPHIC_NOTE_TEMPLATES) {
      const converted = knowledgeCardLandscapeTemplatePrompt(
        template.layoutPromptEn
      );
      expect(converted, template.id).toContain("16:9");
      expect(converted, template.id).not.toMatch(
        /3\s*[:：]\s*4|\bvertical\s+(infographic|poster|canvas|layout|format|orientation)\b|portrait\s+(orientation|canvas|layout|format)/i
      );
      expect(converted.length, template.id).toBeGreaterThan(100);
      expect(converted, template.id).toContain("LAYOUT ONLY");
      expect(template.aspect).toBe("3:4");
    }
    expect(JSON.stringify(INFOGRAPHIC_NOTE_TEMPLATES)).toBe(original);
  });
});


it("横版画幅保留内部纵向时间轴语义", () => {
  const text = "3:4 vertical infographic. Hero: precise vertical chronological / staged timeline";
  const result = knowledgeCardLandscapeTemplatePrompt(text);
  expect(result).toContain("16:9 landscape infographic");
  expect(result).toContain("precise vertical chronological / staged timeline");
});
