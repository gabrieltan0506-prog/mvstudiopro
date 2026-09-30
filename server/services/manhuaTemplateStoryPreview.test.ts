import { describe, expect, it, vi } from "vitest";
import { buildManhuaTemplateStoryPreview } from "./manhuaTemplateStoryPreview";
import { toPublicManhuaViralTemplateCard, formatManhuaViralTemplateWriterSkillFromCard, type ManhuaViralTemplateCard } from "../../shared/manhuaViralTemplateBank";
import { buildManhuaWriterTrialPrompt } from "./manhuaWriterTrial";
import { buildManhuaWriterExpandPrompt } from "../../shared/manhuaWriterRoom";

function card(reusableZh: string): ManhuaViralTemplateCard {
  return { id: "tpl_private_sentinel", nameZh: "来源真名不可公开", laneZh: "悬疑权谋", publicCode: "A123", status: "approved",
    summaryZh: "秘密能力正文", hook3sZh: "主人公面对盘问与试探，身份尚未揭开。来源人物甲",
    classification: { emotionTagsZh: ["紧张"], narrativeFeatureTagsZh: ["身份揭秘"], performanceTagsZh: [], audiovisualTagsZh: [], audienceExperienceTagsZh: ["好奇"] },
    beatGrid: [{ atSec: 0, conflictZh: "身份质疑", visualZh: "来源人物甲面对长官" }, { atSec: 10, conflictZh: "后续秘密反转哨兵", visualZh: "私有画面哨兵" }],
    reusableZh, genPromptHintZh: "完整画面手法哨兵", storyStructure: { corePromiseZh: "完整故事承诺哨兵", conflictEngineZh: "完整冲突引擎哨兵", relationshipEngineZh: "完整关系引擎哨兵", episodeProgressionZh: ["全剧推进哨兵"], variationRulesZh: ["避免重复规则哨兵"] },
    castShape: { leadDesireZh: "待补：不能猜", pressureZh: "待补：不能猜" }, densityHints: { minBodyChars: 280, minDialogueLines: 8, minLocationHits: 2 }, scenePoolHints: ["私有场景哨兵"], sourceRefs: [{ url: "https://private-source.invalid/secret", fetchedAt: "2026-09-30" }],
  };
}

vi.mock("./manhuaTemplateStoryPreviewCopy.js", async () => {
  const { createHash } = await import("node:crypto");
  const sample = card("");
  const evidenceSha256 = createHash("sha256").update(JSON.stringify({ hook: sample.hook3sZh, summary: sample.summaryZh, narrative: sample.classification?.narrativeFeatureTagsZh || [], early: sample.beatGrid.slice(0, 3).map(b => ({ conflictZh: b.conflictZh, visualZh: b.visualZh })) })).digest("hex");
  return { MANHUA_TEMPLATE_STORY_PREVIEW_COPY: { A123: { evidenceSha256, storyTypeZh: "身份与立威", teaserTitleZh: "面对试探的新来者", premiseZh: "新人要在盘问中站稳位置。", openingZh: "一次试探改变了他的处境。", earlyProgressionZh: "他会怎样回应？" } } };
});

describe("有限模板故事预览", () => {
  it("人工开篇只匹配已核证据版本，旧版本不冒充新卡且hash不公开", () => {
    const current = card("微表情");
    const preview = buildManhuaTemplateStoryPreview(current)!;
    expect(preview.teaserTitleZh).toBe("面对试探的新来者");
    expect(buildManhuaTemplateStoryPreview({ ...current, summaryZh: "新的故事能力" })?.teaserTitleZh).toBeUndefined();
    const json = JSON.stringify(toPublicManhuaViralTemplateCard(current, null, preview));
    expect(json).not.toContain("evidenceSha256"); expect(json).not.toContain("secret");
  });
  it("同紧张标签的不同表现手法保持可辨，不合并公开ID", () => {
    const a = card("通过微表情、眼神和反应停顿，观察内心变化");
    const b = { ...card("用音效和死寂声音牵引，声画变化组织声音"), publicCode: "B456" };
    const pa = toPublicManhuaViralTemplateCard(a, null, buildManhuaTemplateStoryPreview(a))!;
    const pb = toPublicManhuaViralTemplateCard(b, null, buildManhuaTemplateStoryPreview(b))!;
    expect(pa.classificationTagsZh).toEqual(pb.classificationTagsZh);
    expect(pa.publicId).not.toBe(pb.publicId);
    expect(pa.storyPreview?.presentationTagsZh).toContain("反应与停顿");
    expect(pb.storyPreview?.presentationTagsZh).toContain("声音牵引");
    expect(pa.storyPreview?.presentationTagsZh).not.toEqual(pb.storyPreview?.presentationTagsZh);
  });
  it("选模板只给匿名开篇，不泄露任何剧情、源和完整精华哨兵", () => {
    const privateCard = card("完整可复用手法哨兵：通过微表情展现内心");
    const pub = toPublicManhuaViralTemplateCard(privateCard, null, buildManhuaTemplateStoryPreview(privateCard))!;
    const json = JSON.stringify(pub);
    for (const hidden of ["来源真名", "来源人物甲", "哨兵", "tpl_private", "private-source", "beatGrid", "reusableZh", "storyStructure", "sourceRefs"]) expect(json).not.toContain(hidden);
    expect(pub.storyPreview?.presentationTagsZh.length).toBeLessThanOrEqual(2);
    expect(JSON.stringify(pub.storyPreview).length).toBeLessThan(400);
  });
  it("缺开篇证据或非approved不捏造大纲，旧公开卡仍可见", () => {
    const noEvidence = { ...card(""), hook3sZh: "", beatGrid: [] };
    expect(buildManhuaTemplateStoryPreview(noEvidence)).toBeUndefined();
    expect(toPublicManhuaViralTemplateCard(noEvidence)?.publicId).toBe("mt_a123");
    expect(buildManhuaTemplateStoryPreview({ ...card(""), status: "proposed" })).toBeUndefined();
  });
  it("试写与正式扩写真实prompt得到同一完整能力，有限预览不是模型底料", () => {
    const privateCard = card("完整可复用手法哨兵");
    const addon = formatManhuaViralTemplateWriterSkillFromCard(privateCard);
    const trial = buildManhuaWriterTrialPrompt({ topic: "自写题材", brief: "", templateAddon: addon });
    const expand = buildManhuaWriterExpandPrompt({ topic: "自写题材", brief: "", episodeCount: 2, viralTemplateAddon: addon });
    for (const content of ["完整可复用手法哨兵", "完整画面手法哨兵", "完整故事承诺哨兵", "完整冲突引擎哨兵", "全剧推进哨兵", "避免重复规则哨兵"]) {
      expect(trial).toContain(content);
      expect(expand).toContain(content);
    }
  });
});
