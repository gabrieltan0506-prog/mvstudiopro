import { describe, expect, it } from "vitest";
import {
  buildManhuaEpisodeSegmentPlanFixtureMarkdown,
  evaluateManhuaEpisodeSegmentPlanQuality,
  formatManhuaEpisodeSegmentPlanBeatsBlock,
  formatManhuaEpisodeSegmentPlanPromptBlock,
  parseManhuaEpisodeSegmentPlanFromMarkdown,
} from "./manhuaEpisodeSegmentPlan";
import { evaluateWriterPackAssetAndDensity } from "./manhuaWriterAssetCanon";
import { composeWriterPackFactoryContext, type ManhuaWriterPack } from "./manhuaWriterRoom";
import { composeManhuaNarrativeEngineBlock } from "./manhuaNarrativeEnginePrompt";
import { composeManhuaEpisodeQualityBlock } from "./manhuaEpisodeQualityPrompt";
import { stripManhuaClipForbiddenBoards } from "./manhuaClipPromptSanitize";

function original(count: number): string {
  const first = buildManhuaEpisodeSegmentPlanFixtureMarkdown().split("#### 段01\n")[1].split("#### 段02")[0];
  return Array.from({ length: count }, (_, i) => `#### 段${String(i + 1).padStart(2, "0")}\n${first
    .replace("第1次", `第${i + 1}次`)
    .replace("雨夜回廊", i % 2 ? "烛火偏殿" : "雨夜回廊")}`).join("\n");
}

describe("原稿可拍表全量验收", () => {
  it.each([1, 2, 10, 25, 100])("完整保留并验收 %i 段，单段不要求虚构换场", (count) => {
    const md = original(count);
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(md);
    expect(plan.segmentCount).toBe(count);
    expect(plan.segments).toHaveLength(count);
    expect(plan.segments.at(-1)?.index).toBe(count);
    expect(evaluateManhuaEpisodeSegmentPlanQuality(plan, { mode: "actual" })).toEqual({
      ok: true, readyCount: count, requiredCount: count, issues: [],
    });
    expect(formatManhuaEpisodeSegmentPlanBeatsBlock(plan)).toContain(`共${count}段`);
  });

  it("第 100 段缺字段不能因前六段合格而放行", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(original(100));
    plan.segments[99].lightingCameraZh = "";
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan, { mode: "actual" });
    expect(q.ok).toBe(false);
    expect(q.readyCount).toBe(99);
    expect(q.issues.join("\n")).toContain("段100 缺字段");
    expect(evaluateManhuaEpisodeSegmentPlanQuality(plan, { min: 4, max: 6 }).ok).toBe(true);
  });

  it("断档之后继续查字段，空表不通过", () => {
    const plan = parseManhuaEpisodeSegmentPlanFromMarkdown(original(25));
    plan.segments.splice(6, 1);
    plan.segments.at(-1)!.castZh = "";
    const q = evaluateManhuaEpisodeSegmentPlanQuality(plan, { mode: "actual" });
    expect(q.ok).toBe(false);
    expect(q.issues.join("\n")).toContain("段号不连续");
    expect(q.issues.join("\n")).toContain("段25 缺字段");
    expect(evaluateManhuaEpisodeSegmentPlanQuality(null, { mode: "actual" }).ok).toBe(false);
  });

  it("包装门禁默认全表，既有布局参数不能掩盖第七段缺失", () => {
    const body = original(7).replace(/#### 段07[\s\S]*$/, "#### 段07\n- 场景：雨夜回廊");
    const input = { episodes: [{ index: 1, body, endHook: "门后传来脚步" }], segmentMin: 4, segmentMax: 6 };
    const actual = evaluateWriterPackAssetAndDensity(input);
    expect(actual.errors.join("\n")).toContain("段07 缺字段");
    const legacy = evaluateWriterPackAssetAndDensity({ ...input, segmentCountMode: "layout" });
    expect(legacy.errors.join("\n")).not.toContain("段07 缺字段");
  });

  it("工厂上下文保留全稿且不再强制五至六段", () => {
    const body = original(25);
    const pack: ManhuaWriterPack = { rawMarkdown: body, episodeCount: 1, seriesTitle: "原稿测试", logline: "保留原作", charactersMd: "", propsMd: "", locationsMd: "", episodes: [{ index: 1, title: "第一集", body, endHook: "开门" }] };
    const context = composeWriterPackFactoryContext(pack);
    expect(context).toContain(body);
    expect(context).toContain("共25段");
    expect(context).not.toContain("·15s】");
    expect(context).not.toMatch(/5–6 段|五至六段/);
  });

  it("原稿提示不塞固定配额，新写作参考模板仍保留", () => {
    expect(composeManhuaNarrativeEngineBlock()).not.toMatch(/75–90|5–6 段|6–12 句|约 15 秒\/段/);
    expect(composeManhuaEpisodeQualityBlock()).not.toMatch(/75–90|5–6 段|6–12 句|约 4 张静帧/);
    expect(composeManhuaNarrativeEngineBlock({ sourceMode: "new-writing" })).toContain("75–90");
    expect(formatManhuaEpisodeSegmentPlanPromptBlock()).toContain("五至六段可拍表");
  });

  it.each(["已确认原稿可拍表·共25段·保留完整内容", "已确认五至六段可拍表·禁止改写成灌水", "已确认十至十二段可拍表"])("消毒兼容标题：%s", (heading) => {
    const result = stripManhuaClipForbiddenBoards(`【${heading}】\n不应进入模型的整集规则\n【第1段·10s】\n0–10秒：推门进入`);
    expect(result).not.toContain("不应进入模型");
    expect(result).toContain("0–10秒：推门进入");
  });
});
