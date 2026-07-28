import { describe, expect, it } from "vitest";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  deriveManhuaSegmentIntentFallbackZh,
  evaluateManhuaEpisodeSegmentPlanQuality,
  formatManhuaEpisodeSegmentPlanPromptBlock,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
  inferManhuaCastZhFromDialogue,
  upsertManhuaSegmentCastInMarkdown,
  upsertManhuaSegmentIntentInMarkdown,
} from "./manhuaEpisodeSegmentPlan";

describe("manhuaEpisodeSegmentPlan", () => {
  it("parses 6 segments and passes quality", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(buildManhuaEpisodeSegmentPlanFixtureMarkdown());
    expect(plan.segments).toHaveLength(6);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(true);
    expect(q.readyCount).toBe(6);
  });

  it("意图兜底：缺意图但对白+表演齐 → 解析时自动补意图、门禁不再卡", () => {
    // 造 5 段：字段齐全但都不写「意图」
    const seg = (n: number, spk: string, line: string, scene: string) =>
      [
        `#### 段${String(n).padStart(2, "0")}`,
        `- 对白：`,
        `  - ${spk}：「${line}」`,
        `  - 对手：「${line}，你听清了没有。」`,
        `  - ${spk}：「今夜过后再说，别回头。」`,
        `- 表演：${spk}咬肌隆起、呼吸短促，却先护住对方；对手眼神由惊转硬。`,
        `- 场景：${scene}`,
        `- 配色风格：墨蓝雨夜、火焰橙红`,
        `- 角色：${spk}、对手`,
        `- 服装道具：玄黑劲装、长剑`,
        `- 光影运镜：低机位贴身推进，焦点落在${spk}侧脸`,
      ].join("\n");
    const md = [
      seg(1, "沈沧澜", "账册在桥中央，我断绳", "断月桥"),
      seg(2, "陆清和", "他们认得你的剑路", "断月桥"),
      seg(3, "沈沧澜", "先活过今夜", "苍云客栈"),
      seg(4, "陆清和", "玉扣为何能合上", "苍云客栈"),
      seg(5, "沈沧澜", "刀该回头见血", "废驿档房"),
    ].join("\n\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(md);
    expect(plan.segments).toHaveLength(5);
    // 每段意图都被自动补上（≥4 字）
    for (const s of plan.segments) {
      expect(s.intentZh.length).toBeGreaterThanOrEqual(4);
    }
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(true);
    expect(q.readyCount).toBe(5);
  });

  it("deriveManhuaSegmentIntentFallbackZh：无对白无表演 → 空串", () => {
    expect(deriveManhuaSegmentIntentFallbackZh({ dialogueZh: "", performanceZh: "" })).toBe("");
    const s = deriveManhuaSegmentIntentFallbackZh({
      dialogueZh: "沈沧澜：「别回头。」",
      performanceZh: "咬肌隆起、呼吸短促",
    });
    expect(s.length).toBeGreaterThanOrEqual(4);
  });

  it("accepts 5 contiguous ready segments", () => {
    const md = buildManhuaEpisodeSegmentPlanFixtureMarkdown()
      .split(/\n#### 段06/)[0]!
      .trim();
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(md);
    expect(plan.segments.length).toBeGreaterThanOrEqual(5);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(true);
    expect(q.readyCount).toBe(5);
  });

  it("rejects filler dialogue and missing fields", () => {
    const thin = [
      "#### 段01",
      "- 对白：嗯",
      "- 表演：皱眉握拳",
      "- 场景：屋里",
      "- 配色风格：暖",
      "- 角色：甲",
      "- 服装道具：衣",
      "- 光影运镜：推",
    ].join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(thin);
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan);
    expect(q.ok).toBe(false);
    expect(q.issues.some((e) => /不足|灌水|缺段|对白仅/.test(e))).toBe(true);
  });

  it("parses nested multi-line dialogue bullets under 对白", () => {
    const md = [
      "#### 段01",
      "- 对白：",
      "  - 甲：「第一句。」",
      "  - 乙：「第二句。」",
      "  - 甲：「第三句。」",
      "- 表演：甲眉心紧、握拳；乙后退半步眼神一颤。",
      "- 场景：雪关关隘",
      "- 配色风格：冷灰",
      "- 角色：甲、乙",
      "- 服装道具：旧甲",
      "- 光影运镜：中近景",
      "#### 段02",
      "- 对白：「一」「二」「三」",
      "- 表演：甲侧脸咬肌隆起，乙握拳。",
      "- 场景：破屋",
      "- 配色风格：暖灰",
      "- 角色：甲、乙",
      "- 服装道具：锄",
      "- 光影运镜：推",
    ].join("\n");
    // pad to 10 with fixture tail
    const more = buildManhuaEpisodeSegmentPlanFixtureMarkdown()
      .split(/\n#### 段/)
      .slice(3)
      .map((chunk, i) => `#### 段${String(i + 3).padStart(2, "0")}${chunk.includes("\n") ? chunk.slice(chunk.indexOf("\n")) : ""}`)
      .join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(`${md}\n${more}`);
    expect(plan.segments[0]?.dialogueZh).toMatch(/第一句/);
    expect(
      (plan.segments[0]?.dialogueZh.match(/「[^」]+」/g) || []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  it("rejects only two dialogue quotes in a 15s segment", () => {
    const two = [
      "#### 段01",
      "- 意图：羞辱与隐忍对撞",
      "- 对白：「罪户只配吃风。」「断粮的人才想杀人。」",
      "- 表演：马县丞踢瓮冷笑；苏照雪接种子时眼神一凛、肩线绷紧。",
      "- 场景：开荒村破屋",
      "- 配色风格：冷灰雪白",
      "- 角色：苏照雪、马县丞",
      "- 服装道具：破袍、空粮瓮",
      "- 光影运镜：中近景固定",
    ].join("\n");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(
      `${two}\n` + buildManhuaEpisodeSegmentPlanFixtureMarkdown().replace(/^###[^\n]+\n/, ""),
    );
    // 段01 仅 2 句应拦下，后续合格段不算连续
    const q = evaluateManhuaEpisodeSegmentPlanQuality(
      parseManhuaEpisodeSegmentPlanFromMarkdown(two),
    );
    expect(q.ok).toBe(false);
    expect(q.issues.some((e) => /对白仅|至少 3/.test(e))).toBe(true);
    void plan;
  });

  it("prompt block asks for 5–6 ×15s and performance", () => {
    const block = formatManhuaEpisodeSegmentPlanPromptBlock();
    expect(block).toMatch(/5/);
    expect(block).toMatch(/6/);
    expect(block).toMatch(/15 秒/);
    expect(block).toMatch(/意图/);
    expect(block).toMatch(/对白/);
    expect(block).toMatch(/表演/);
    expect(block).toMatch(/3–4/);
    expect(block).toMatch(/配色风格/);
    expect(block).toMatch(/光影运镜/);
  });

  it("upserts segment intent into markdown and re-parses", () => {
    const md = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
    const next = upsertManhuaSegmentIntentInMarkdown(md, 2, "新意图·试探转硬碰");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(next);
    expect(plan.segments.find((s) => s.index === 2)?.intentZh).toContain("新意图");
  });

  it("infers cast from dialogue speakers when 角色 empty", () => {
    expect(
      inferManhuaCastZhFromDialogue(
        "",
        "苏文谦：「你取账。」苏照雪：「我断绳。」",
      ),
    ).toContain("苏文谦");
    expect(
      inferManhuaCastZhFromDialogue("已有名单", "苏文谦：「你取账。」"),
    ).toBe("已有名单");
  });

  it("upserts segment cast into markdown and re-parses", () => {
    const md = buildManhuaEpisodeSegmentPlanFixtureMarkdown();
    const next = upsertManhuaSegmentCastInMarkdown(md, 1, "苏文谦、苏照雪");
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(next);
    expect(plan.segments.find((s) => s.index === 1)?.castZh).toContain("苏文谦");
  });
});
