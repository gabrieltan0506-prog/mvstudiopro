import { describe, expect, it } from "vitest";
import { advisorModelContract, ADVISOR_REVIEW_MODEL_IDS, buildAdvisorModelReviewFacts } from "./manhuaAdvisorModelReview";
import { manhuaCreativeAdvisorContextSchema, type ManhuaCreativeAdvisorContext } from "./manhuaCreativeAdvisor";
import { tryCompileManhuaVideoPromptForOutbound } from "./manhuaOutboundPrompt";
const context: ManhuaCreativeAdvisorContext = {
  seriesTitle: "测试剧", episodeTitle: "第一集", episodeIndex: 1, stage: "storyboard", videoModel: "seedance-2.5", writerConfirmed: true,
  episodeBody: "", assetSummary: "", shotSummary: "", blockers: [],
  videoPromptReview: { blockId: "clip-e01-g01", segmentIndex: 1, videoModel: "seedance-2.5", aspectRatio: "9:16", resolution: "720p", prompt: "【第1段·29s】\n棕马左前腿悬空。@图片1。娘说「慢点」。" },
};
describe("顾问共享模型合同和文本编译核对", () => {
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
