import { describe, expect, it } from "vitest";
import { assertCompleteTopicText, bindTopicEvidence, resolveTopicWindowDays } from "./platformTopicIntegrity";
import { buildXhsGrowthEvidence } from "./xhsContentStrategy";
import { rankTopicShortlistByViralScore } from "./platformTopicShortlist";

const complete = { title: "开会突然被问进度如何回应", hookSketch: "先交代结论，再补事实。", conveyGoal: "让职场新人能当场回应提问。", viralReason: "对应会议中常见的表达困难，便于直接练习。" };
describe("选题窗口和完整性", () => {
  it.each([["最近七天",30,7],["最近7天",15,7],["最近十五天",7,15],["最近七天到十五天",30,15],["",30,15],["",7,7]] as const)("%s、旧窗口%s → %s", (context, selected, expected) => expect(resolveTopicWindowDays(context,selected)).toBe(expected));
  it("完整长文逐字保留；半句、括号缺失、标题越界不能静默切掉", () => {
    const long = "完整的切口和行动解释。".repeat(250);
    expect(() => assertCompleteTopicText({...complete, conveyGoal:long, hookSketch:long})).not.toThrow();
    for (const field of ["conveyGoal","hookSketch","viralReason"]) {
      expect(() => assertCompleteTopicText({...complete, [field]:"承接动作：关注看下"})).toThrow("未完整结束");
      expect(() => assertCompleteTopicText({...complete, [field]:"这份理由（没有闭合。"})).toThrow("未完整结束");
    }
    expect(() => assertCompleteTopicText({...complete,title:"长".repeat(121)})).toThrow("未截断");
    expect(() => assertCompleteTopicText({...complete,viralReason:"符合人设空壳禁令。"})).toThrow("内部指令");
  });
  it("引用只使用原库真实ID及其指标，跨平台和无日期无链接样本不能冒充依据", () => {
    const now = Date.parse("2026-10-30T00:00:00Z");
    const evidence = buildXhsGrowthEvidence([
      {id:"meeting",title:"会议沟通练习",publishedAt:"2026-10-29",url:"https://example.com/meeting",likes:12,comments:3},
      {id:"dance",title:"舞蹈服装展示",publishedAt:"2026-10-29",url:"https://example.com/dance",likes:999},
      {id:"observed",title:"会议沟通练习",observedAt:"2026-10-29",url:"https://example.com/observed",likes:9},
    ],7,now);
    const bound = bindTopicEvidence([{platform:"xiaohongshu",id:"meeting",likes:9999},{platform:"xiaohongshu",id:"forged"},{platform:"douyin",id:"meeting"},{platform:"xiaohongshu",id:"dance"},{platform:"xiaohongshu",id:"observed"}],"会议沟通",evidence)!;
    expect(bound.samples.map(row=>row.id)).toEqual(["meeting"]);
    expect(bound.samples[0].likes).toBe(12); expect(bound.samples[0].comments).toBe(3);
    expect(bindTopicEvidence([],"会议沟通",evidence)?.samples).toEqual([]);
    expect(bindTopicEvidence([{platform:"xiaohongshu",id:"meeting"}],"会议沟通",{...evidence,windowStart:"2026-09-01"})?.samples).toEqual([]);
  });
  it("2–3条候选只优先一条；无分低分不会假推荐", () => {
    const rows=rankTopicShortlistByViralScore([{id:"a",viralScore:90,commentHeat:90},{id:"b",viralScore:75,commentHeat:70},{id:"c",viralScore:40,commentHeat:50}]);
    expect(rows.filter(row=>row.isTopPick).map(row=>row.id)).toEqual(["a"]);
    expect(rankTopicShortlistByViralScore([{viralScore:10},{isTopPick:true}]).some(row=>row.isTopPick)).toBe(false);
    expect(rankTopicShortlistByViralScore([{viralScore:90},{viralScore:90}]).some(row=>row.isTopPick)).toBe(false);
    expect(rankTopicShortlistByViralScore([{viralScore:99,conveyGoal:"承接动作：关注看下"}]).some(row=>row.isTopPick)).toBe(false);
  });
});
