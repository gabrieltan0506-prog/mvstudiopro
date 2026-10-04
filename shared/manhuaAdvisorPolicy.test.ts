import { describe, expect, it } from "vitest";
import { automaticAdvisorContext, automaticAdvisorRequestId, MANHUA_ADVISOR_PAID_CREDITS, MANHUA_ADVISOR_PROJECT_FREE } from "./manhuaAdvisorPolicy";
import { manhuaCreativeAdvisorContextSchema } from "./manhuaCreativeAdvisor";

const context = manhuaCreativeAdvisorContextSchema.parse({ seriesTitle: "测试剧", episodeIndex: 1, episodeTitle: "入局", stage: "storyboard", videoModel: "未选择", writerConfirmed: true, episodeBody: "两人沿医馆走廊移动。", assetSummary: "已有医馆场景", shotSummary: "全景切近景", blockers: [], projectId: "6f9619ff-8b86-4d01-b42d-00cf4fc964ff" });
describe("作品顾问计次与自动检查身份", () => {
  it("每作品5次及12积分固定，不读取平台档位或日期", () => {
    expect([MANHUA_ADVISOR_PROJECT_FREE, MANHUA_ADVISOR_PAID_CREDITS]).toEqual([5, 12]);
  });
  it("余额、队列、对话回包变化不会再次触发自动检查", async () => {
    const id = await automaticAdvisorRequestId("7", context);
    expect(await automaticAdvisorRequestId("7", { ...context, creditsZh: "余额减少12", queueZh: "顾问已返回", history: [{ role: "assistant", content: "已提出建议" }] })).toBe(id);
    expect(id).toMatch(/^[a-f0-9-]{14}5[a-f0-9-]{21}$/);
    expect(automaticAdvisorContext(context).history).toBeUndefined();
  });
  it("账户、作品、集数或正文变化分别产生新检查，改标题不会改作品ID", async () => {
    const old = await automaticAdvisorRequestId("7", context);
    for (const next of [{ ...context, projectId: "7f9619ff-8b86-4d01-b42d-00cf4fc964ff" }, { ...context, episodeIndex: 2 }, { ...context, episodeBody: "两人在屋内对峙。" }]) expect(await automaticAdvisorRequestId("7", next)).not.toBe(old);
    expect(await automaticAdvisorRequestId("8", context)).not.toBe(old);
    expect(automaticAdvisorContext({ ...context, seriesTitle: "改名" }).projectId).toBe(context.projectId);
  });
});
