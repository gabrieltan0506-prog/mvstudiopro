import { describe, expect, it } from "vitest";
import { advisorModelContract, ADVISOR_REVIEW_MODEL_IDS, buildAdvisorModelReviewFacts, findAdvisorPromptContradictions, composeAdvisorPromptReviewAnswer } from "./manhuaAdvisorModelReview";
import { manhuaCreativeAdvisorContextSchema, type ManhuaCreativeAdvisorContext } from "./manhuaCreativeAdvisor";
import { tryCompileManhuaVideoPromptForOutbound } from "./manhuaOutboundPrompt";
const context: ManhuaCreativeAdvisorContext = {
  seriesTitle: "测试剧", episodeTitle: "第一集", episodeIndex: 1, stage: "storyboard", videoModel: "seedance-2.5", writerConfirmed: true,
  episodeBody: "", assetSummary: "", shotSummary: "", blockers: [],
  videoPromptReview: { blockId: "clip-e01-g01", segmentIndex: 1, videoModel: "seedance-2.5", aspectRatio: "9:16", resolution: "720p", prompt: "【第1段·29s】\n棕马左前腿悬空。@图片1。娘说「慢点」。" },
};
describe("顾问共享模型合同和文本编译核对", () => {
  const conflictingPrompt = "【第1段·29s】\n0–2.5s：棕马墨屠，左前腿明显蜷起悬空。\n5–8s：蜷腿落在湿石板，眼罩与肩伤同框；受伤的左前腿蜷起悬空，右前蹄吃力打滑。\n22–29s：阿菁前景偏左、黑马/眼罩占左。";
  it("真实第一段措辞的两处候选送入模型与最终答复，漏报也不丢定位", () => {
    const reviewContext = { ...context, videoPromptReview: { ...context.videoPromptReview!, prompt: conflictingPrompt } };
    const snapshot = JSON.stringify(reviewContext);
    expect(findAdvisorPromptContradictions(conflictingPrompt).map(f => [f.id, f.window])).toEqual([["limb-state", "5–8s"], ["horse-color", "22–29s"]]);
    const facts = buildAdvisorModelReviewFacts(reviewContext);
    expect(facts).toContain('"referenceCounts":"未验证"');
    expect(facts).toContain('"id":"limb-state"');
    const answer = composeAdvisorPromptReviewAnswer("未发现其他矛盾。", reviewContext);
    expect(answer).toContain("右前蹄踩住湿石板，左前腿继续蜷起悬空");
    expect(answer).toContain("棕马墨屠/眼罩");
    expect(answer).toContain("不能证明数量合规或没有音视频参考");
    expect(answer).toContain("系统现有门禁仍有效");
    expect(JSON.stringify(reviewContext)).toBe(snapshot);
  });
  it("不同肢体、不同秒窗和明确变身不混为冲突，不声称无问题", () => {
    expect(findAdvisorPromptContradictions("5–8s：左前腿悬空，右前腿落地。")).toEqual([]);
    expect(findAdvisorPromptContradictions("5–8s：左前腿悬空。\n8–13s：左前腿落地。")).toEqual([]);
    expect(findAdvisorPromptContradictions("0–5s：棕马墨屠。\n5–8s：变成黑马/眼罩。")).toEqual([]);
    expect(composeAdvisorPromptReviewAnswer("建议核对", context)).toContain("不代表全文没有矛盾");
    expect(composeAdvisorPromptReviewAnswer("白模方案", { ...context, studio3d: {} })).toBe("白模方案");
  });
  it.each(ADVISOR_REVIEW_MODEL_IDS)("%s 能按生产模型合同读取参数，不串方言", id => {
    const contract = advisorModelContract(id);
    expect(contract.recognized).toBe(true);
    if (!contract.recognized) return;
    expect(contract.productResolutions.length).toBeGreaterThan(0);
    expect(contract.callContractZh).toBeTruthy();
    expect(contract.automaticPromptZh).toContain("自动");
    const result = tryCompileManhuaVideoPromptForOutbound({ prompt: "娘说「慢点」。@图片1", engine: id, durationSec: 10, imageRefCount: 1 });
    expect(result.blocked).toBe(false);
    expect(result.text).toContain(contract.dialect === "seedance" ? "{慢点}" : "“慢点”");
  });
  it("29秒中文引号是自动转换，不是假门禁；参数目录和保存设置都到服务端", () => {
    const parsed = manhuaCreativeAdvisorContextSchema.parse(context);
    const facts = buildAdvisorModelReviewFacts(parsed);
    expect(facts).toContain('"durationSec":29');
    expect(facts).toContain('"blocked":false');
    expect(facts).toContain("{慢点}");
    expect(facts).toContain("用户无需手改");
    expect(facts).toContain("尚未解析");
    expect(facts).toContain("不能因只改文字强迫重出图片");
  });
  it("同一29秒换2.0确实超时长，不截断草稿或改对白", () => {
    const result = tryCompileManhuaVideoPromptForOutbound({ prompt: context.videoPromptReview!.prompt, engine: "seedance-2.0", durationSec: 29 });
    expect(result.blocked).toBe(true);
    expect(result.issues.length).toBeGreaterThan(0);
    expect(result.text).toContain("{慢点}");
    expect(context.videoPromptReview!.prompt).toContain("29s");
  });
  it("H3产品时长/画质与上游能力区分，实际设置差异给定位，不要求补图", () => {
    const facts = buildAdvisorModelReviewFacts({ ...context, videoModel: "minimax-h3", videoPromptReview: { ...context.videoPromptReview!, prompt: "【第1段·7s】娘说「慢点」。", videoModel: "minimax-hailuo-3", resolution: "4K" } });
    expect(facts).toContain("不是本产品可选时长5/10/15");
    expect(facts).toContain('"effectiveQuality":"768p"');
    expect(facts).toContain("不代表需要重出图片");
  });
  it("旧请求和未知模型明确未核，拒绝URL/凭证及额外字段", () => {
    const { videoPromptReview, ...legacy } = context;
    expect(manhuaCreativeAdvisorContextSchema.safeParse(legacy).success).toBe(true);
    expect(buildAdvisorModelReviewFacts(legacy)).toContain("未提供保存节点设置");
    expect(advisorModelContract("不存在的模型").recognized).toBe(false);
    expect(manhuaCreativeAdvisorContextSchema.safeParse({ ...context, videoPromptReview: { ...videoPromptReview, prompt: "https://example.com/private" } }).success).toBe(false);
    expect(manhuaCreativeAdvisorContextSchema.safeParse({ ...context, videoPromptReview: { ...videoPromptReview, apiKey: "test-key" } }).success).toBe(false);
  });
});
