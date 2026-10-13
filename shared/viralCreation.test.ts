import { describe, expect, it } from "vitest";
import { buildXhsGrowthEvidence, XHS_CONTENT_SKILL_ID, XHS_IMAGE_POLICY } from "./xhsContentStrategy";
import { xhsGrowthEvidenceSchema } from "./xhsContentEvidenceSchema";
import { auditXhsCreationPackage, connectXhsPackageToBlueprint } from "./xhsCreationPackage";
import { buildViralMethodPlan } from "./viralCreationMethods";
import { planViralExpansions } from "./viralCreationSelection";
import { fictionalViralBlueprint } from "./viralCreation.fixture";
import { platformTopicShortlistItemSchema } from "./platformTopicShortlist";

const now = Date.parse("2026-10-14T00:00:00Z");
const pick = platformTopicShortlistItemSchema.parse({ id: "topic-001", title: "会议突然被点名该怎么办", hookSketch: "先确认问题再回答", conveyGoal: "给出可执行的会议表达方法", skillsUsed: [XHS_CONTENT_SKILL_ID], primaryLane: "default", formatHint: "图文", dedupeKey: "topic-001" });
describe("爆款创作：资料规则与真实证据契约", () => {
  it("按场景匹配，旧日期与未知日期不冒充窗口证据", () => {
    const evidence = buildXhsGrowthEvidence([
      { id: "related", title: "会议表达与职场沟通", publishedAt: "2026-10-13T00:00:00Z", likes: 3 },
      { id: "hot", title: "旅游攻略", publishedAt: "2026-10-13T00:00:00Z", likes: 999 },
      { id: "old", title: "会议表达", publishedAt: "2025-01-01" },
      { id: "unknown", title: "会议表达", publishedAt: "昨天" },
      { id: "related", title: "会议表达与职场沟通", publishedAt: "2026-10-13T00:00:00Z" },
    ], 7, now, "职场沟通会议表达", "douyin");
    expect(evidence.samples.map(s => s.id)).toEqual(["related"]);
    expect(evidence.excludedOutsideWindow).toBe(1); expect(evidence.excludedUnknownDate).toBe(1); expect(evidence.duplicateCount).toBe(1);
    expect(evidence.platform).toBe("douyin"); expect(xhsGrowthEvidenceSchema.safeParse(evidence).success).toBe(true);
  });
  it("无数据仍可创作，但明确无证据，不补虚构样本", () => {
    const evidence = buildXhsGrowthEvidence([], 7, now); expect(evidence.samples).toEqual([]); expect(evidence.note).toContain("须另行验证");
  });
  it("源数据过长、坏链接、非数字指标均能在API契约内表达", () => {
    const evidence = buildXhsGrowthEvidence([{ id: "id", title: "题".repeat(4000), observedAt: "1791849600000", url: "javascript:alert(1)", likes: true, tags: Array(150).fill("标".repeat(300)) }], 30, now);
    expect(xhsGrowthEvidenceSchema.safeParse(evidence).success).toBe(true); expect(evidence.samples[0]?.likes).toBeUndefined(); expect(evidence.samples[0]?.url).toBeUndefined();
  });
  it("资料结构可解释推荐，并提供三个备选", () => {
    const plan = buildViralMethodPlan("我要做同条件测评和比较", "acquire"); expect(plan.primary.id).toBe("comparison"); expect(plan.alternatives).toHaveLength(3); expect(plan.primary.sources).toContain("S3 第10页"); expect(plan.conversion.action).toContain("站内咨询");
  });
  it.each(["图文", "短视频"] as const)("%s稿件审查真实非空字段与方法原文", format => {
    expect(auditXhsCreationPackage(fictionalViralBlueprint(format), undefined, format).passed).toBe(true);
  });
  it("空图文页、不完整分镜、假引用与不同形式均拒绝", () => {
    const bp = fictionalViralBlueprint(); bp.graphicNotePages = [];
    expect(auditXhsCreationPackage(bp).findings.map(f => f.code)).toContain("graphic_pages");
    const video = fictionalViralBlueprint("短视频"); video.storyboardCells[0].actionZh = "";
    expect(auditXhsCreationPackage(video).findings.map(f => f.code)).toContain("storyboard_cells");
    const forged = fictionalViralBlueprint(); forged.xhsPackage.promiseDelivery[0].quote = "正文根本没有出现的承诺";
    expect(auditXhsCreationPackage(forged).findings.map(f => f.code)).toContain("promise_quote_missing");
    expect(auditXhsCreationPackage(fictionalViralBlueprint(), undefined, "短视频").findings.map(f => f.code)).toContain("format_mismatch");
  });
  it("空方法应用和重复结构落点不能假装资料已应用", () => {
    const bp = fictionalViralBlueprint(); bp.methodApplications = []; bp.xhsPackage.structure.steps[1].quote = bp.xhsPackage.structure.steps[0].quote;
    const codes = auditXhsCreationPackage(bp).findings.map(f => f.code); expect(codes).toContain("method_application"); expect(codes).toContain("structure_quote");
  });
  it("平台×形式独立记录，重试不再扩成四份，旧模式不变", () => {
    const rows = planViralExpansions([pick], ["xiaohongshu", "douyin"], ["图文", "短视频"]);
    expect(planViralExpansions([{ ...pick, creationPlatforms: ["xiaohongshu"] }], ["douyin"], ["图文"])[0].targetPlatform).toBe("douyin");
    expect(rows).toHaveLength(4); expect(new Set(rows.map(p => p.id)).size).toBe(4); expect(rows.every(p => platformTopicShortlistItemSchema.safeParse(p).success)).toBe(true);
    expect(planViralExpansions([rows[2]], ["xiaohongshu", "douyin"], ["图文", "短视频"])).toEqual([rows[2]]);
    const old = { ...pick, skillsUsed: ["old-skill"] }; expect(planViralExpansions([old], ["douyin"], ["短视频"])).toEqual([old]);
  });
  it("封面方案穿透旧消费字段并绑定目标平台", () => {
    const bp: Record<string, unknown> = { ...fictionalViralBlueprint(), targetPlatform: "douyin" };
    connectXhsPackageToBlueprint(bp, fictionalViralBlueprint().xhsPackage);
    expect(JSON.stringify(bp.executionDetails)).toContain("同一名浅蓝衬衣"); expect((bp.platformVariants as any[])[0].platform).toBe("douyin");
    expect(XHS_IMAGE_POLICY).toMatchObject({ openaiImageVariant: "sunburst", requireImageVariant: true, exactSunburst: true });
  });
});
