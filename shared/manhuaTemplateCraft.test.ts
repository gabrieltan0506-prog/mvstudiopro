import { describe, it, expect } from "vitest";
import {
  buildTemplateCraftProfile,
  buildTemplateCraftReview,
  formatTemplateCraftApplication,
} from "./manhuaTemplateCraft";
import {
  toPublicManhuaViralTemplateCard,
  formatManhuaViralTemplateWriterSkillFromCard,
  type ManhuaViralTemplateCard,
} from "./manhuaViralTemplateBank";
import { craftFixture } from "./testFixtures/manhuaTemplateCraft";
describe("新学习模板手法索引", () => {
  it("按具体方法索引，不把作品形式作为分类", () => {
    const c = craftFixture();
    const p = buildTemplateCraftProfile(c);
    expect(p).not.toHaveProperty("forms");
    expect(p.features.map(f => f.id)).toEqual(
      expect.arrayContaining([
        "comic-counter",
        "contact-trust",
        "music-turn",
        "light-contrast",
      ])
    );
    for (const medium of ["真人实拍影像", "2D手绘动画", "3D动画"]) {
      expect(
        buildTemplateCraftProfile(craftFixture({ genPromptHintZh: medium }))
          .features
      ).toEqual(
        buildTemplateCraftProfile(craftFixture({ genPromptHintZh: "" }))
          .features
      );
    }
  });
  it("索引有可追溯字段，未命中内容保留，不篡改学习原稿", () => {
    const c = craftFixture({
      classification: {
        ...craftFixture().classification!,
        narrativeFeatureTagsZh: ["未收录的独特结构"],
      },
    });
    const before = JSON.stringify(c),
      review = buildTemplateCraftReview(c);
    expect(
      review.features.find(f => f.id === "comic-counter")?.evidence
    ).toContainEqual({ field: "reusableZh", text: c.reusableZh });
    expect(review.unindexed).toContainEqual({
      field: "classification.narrativeFeatureTagsZh[0]",
      text: "未收录的独特结构",
    });
    expect(JSON.stringify(c)).toBe(before);
    expect(formatManhuaViralTemplateWriterSkillFromCard(c)).toContain(
      c.reusableZh
    );
    expect(formatTemplateCraftApplication(c)).toContain("没有适用前提");
  });
  it("公开卡只增加白名单名称，不泄露原稿、源、内部ID或证据路径", () => {
    const c = craftFixture();
    const publicText = JSON.stringify(toPublicManhuaViralTemplateCard(c));
    expect(publicText).toContain("反差言语化解压力");
    for (const hidden of [
      "私有剧名",
      "tpl_private",
      "reusableZh",
      "证据路径",
      c.reusableZh!,
    ])
      expect(publicText).not.toContain(hidden);
  });
});
