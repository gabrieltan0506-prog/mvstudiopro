import { describe, expect, it } from "vitest";
import {
  draftFromEvidence,
  exportRemixMarkdown,
  exportRemixPackage,
  remixDraftSchema,
  buildRemixRewriteInput,
  explicitNotePages,
} from "./remixDraft";

describe("复刻编辑稿", () => {
  it("保留全部镜头、长时长和顺序，不套4x8秒", () => {
    const source = Array.from(
      { length: 120 },
      (_, i) => `镜头${i + 1}真实分析`
    );
    const draft = draftFromEvidence(
      { remixExecution: { shootingBlueprint: { storyboard: source } } },
      "video",
      "替换人物"
    );
    expect(draft.units).toHaveLength(120);
    expect(draft.units.every(r => r.durationSeconds === null)).toBe(true);
    draft.units[0].durationSeconds = 3600;
    const restored = remixDraftSchema.parse(JSON.parse(JSON.stringify(draft)));
    expect(exportRemixMarkdown(restored)).toContain("3600秒");
    expect(exportRemixMarkdown(restored)).toContain("镜头120真实分析");
    expect(exportRemixPackage(restored).timelineCreated).toBe(false);
  });
  it("笔记保留完整正文且不混入视频时长音轨", () => {
    const body = "正文".repeat(12000);
    const draft = draftFromEvidence(
      {
        remixExecution: {
          imageTextNoteGuide: {
            coverSetup: "封面构图",
            titleOptions: ["标题"],
            structuredBody: body,
          },
        },
      },
      "note",
      "用自有案例"
    );
    draft.units[0].content = "新封面文案";
    const exported = exportRemixMarkdown(draft);
    expect(exported).toContain(body);
    expect(exported).toContain("新封面文案");
    expect(exported).not.toContain("时长：");
    expect(exported).not.toContain("音乐/音效");
  });
  it("拒绝重复ID、负时长与非有限值，空分析不编造内容", () => {
    const draft = draftFromEvidence({}, "video", "");
    expect(draft.units).toEqual([]);
    const row = {
      id: "a",
      source: "",
      content: "",
      decision: "replace",
      durationSeconds: -1,
      sound: "",
    };
    expect(remixDraftSchema.safeParse({ ...draft, units: [row] }).success).toBe(
      false
    );
    expect(
      remixDraftSchema.safeParse({
        ...draft,
        units: [{ ...row, durationSeconds: Infinity }],
      }).success
    ).toBe(false);
    expect(
      remixDraftSchema.safeParse({
        ...draft,
        units: [
          { ...row, durationSeconds: 1 },
          { ...row, durationSeconds: 1 },
        ],
      }).success
    ).toBe(false);
  });
});

describe("逐项改写与笔记分段", () => {
  it("只送选中项与用户要求，拒绝容量溢出而非截断", () => {
    const draft = draftFromEvidence(
      {
        remixExecution: {
          shootingBlueprint: {
            storyboard: ["第一个镜头的动作与对白", "第二镜不应被送进当前改写"],
          },
        },
      },
      "video",
      "用我的人物"
    );
    draft.units[0].durationSeconds = 240;
    const input = buildRemixRewriteInput(draft, draft.units[0].id);
    expect(input.sourceText).toBe("第一个镜头的动作与对白");
    expect(input.optimizationBrief).toContain("240秒");
    draft.units[0].content = "长".repeat(32001);
    expect(() => buildRemixRewriteInput(draft, draft.units[0].id)).toThrow(
      "单次改写容量"
    );
    expect(draft.units[0].content).toHaveLength(32001);
  });
  it("笔记只按明示页码拆分，整篇发布正文不假定是一页", () => {
    expect(explicitNotePages("这是完整发布正文")).toEqual([]);
    expect(explicitNotePages("## 第1页\n第一段\n## 第2页\n第二段")).toEqual([
      "## 第1页\n第一段",
      "## 第2页\n第二段",
    ]);
    const draft = draftFromEvidence(
      {
        remixExecution: {
          imageTextNoteGuide: {
            coverSetup: "封面",
            structuredBody: "完整正文",
          },
        },
      },
      "note",
      ""
    );
    expect(draft.units).toHaveLength(1);
    expect(draft.body).toBe("完整正文");
  });
});
