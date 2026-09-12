import { describe, expect, it } from "vitest";
import {
  type ManhuaViralTemplateCard,
  isNativeVideoLearnedTemplate,
  isNativeManhuaViralTemplateListItem,
  toManhuaViralTemplateListItem,
} from "./manhuaViralTemplateBank";

const heavyCard = (over: Partial<ManhuaViralTemplateCard> = {}): ManhuaViralTemplateCard => ({
  id: "tpl_demo_ep01",
  nameZh: "某剧节奏卡",
  laneZh: "爽文逆袭",
  summaryZh: "一句话用途",
  hook3sZh: "黄金三秒",
  beatGrid: Array.from({ length: 40 }, (_, i) => ({
    atSec: i, conflictZh: `冲突${i}`, visualZh: `动作${i}`,
    shotSizeZh: "中景", angleZh: "平视", compositionZh: "居中",
    hintZh: "提示", cameraMoveZh: "推", blockingZh: "站位",
  })),
  subtitleTrack: Array.from({ length: 600 }, (_, i) => ({
    atSec: i, textZh: `这是第 ${i} 秒的字幕原文，逐秒铺开就是整卡里最重的一块`,
  })),
  evidenceFrames: Array.from({ length: 60 }, (_, i) => ({
    atSec: i, objectName: `frames/${i}.jpg`, noteZh: "抽帧证据",
  })) as ManhuaViralTemplateCard["evidenceFrames"],
  audioStory: { hasAudio: true } as ManhuaViralTemplateCard["audioStory"],
  reusableZh: "可复用手法",
  genPromptHintZh: "提示词要素",
  scenePoolHints: ["场景一", "场景二"],
  castShape: { leadDesireZh: "想要", pressureZh: "压力" },
  densityHints: {} as ManhuaViralTemplateCard["densityHints"],
  sourceRefs: [],
  status: "approved" as ManhuaViralTemplateCard["status"],
  publicCode: "A7F2",
  provenance: {
    nativeVideoDeepRead: {
      successSegments: 5,
      attemptedSegments: 6,
      assemblyComplete: false,
      completedSegmentIndexes: [0, 1, 2, 3, 4],
      segmentEvidenceObjectNames: Array.from({ length: 60 }, (_, i) => `evidence/${i}.json`),
    },
  } as ManhuaViralTemplateCard["provenance"],
  ...over,
});

const ALLOWED_KEYS = ["id", "nameZh", "summaryZh", "classification", "isNativeLearned", "provenance"];

describe("列表用精简卡", () => {
  it("新页面兼容旧服务端整卡与精简卡，批量旧卡筛选保持相同", () => {
    const native = heavyCard();
    const legacy = heavyCard({ audioStory: undefined, reusableZh: undefined,
      genPromptHintZh: undefined, beatGrid: [] });
    for (const card of [native, legacy]) {
      expect(isNativeManhuaViralTemplateListItem(card)).toBe(isNativeVideoLearnedTemplate(card));
      expect(isNativeManhuaViralTemplateListItem(toManhuaViralTemplateListItem(card)))
        .toBe(isNativeVideoLearnedTemplate(card));
    }
  });

  it("只保留白名单字段，整卡的重字段一个都不下发", () => {
    const item = toManhuaViralTemplateListItem(heavyCard());
    for (const key of Object.keys(item)) expect(ALLOWED_KEYS).toContain(key);
    const serialized = JSON.stringify(item);
    for (const heavy of ["subtitleTrack", "evidenceFrames", "audioStory", "beatGrid",
      "sourceRefs", "densityHints", "scenePoolHints", "castShape", "hook3sZh",
      "reusableZh", "genPromptHintZh", "segmentEvidenceObjectNames"]) {
      expect(serialized).not.toContain(heavy);
    }
    // 字幕原文是整卡里最重的一块，一个字都不该出现在列表回包里
    expect(serialized).not.toContain("这是第 0 秒的字幕原文");
  });

  it("体积至少降一个数量级", () => {
    const card = heavyCard();
    const before = Buffer.byteLength(JSON.stringify(card), "utf8");
    const after = Buffer.byteLength(JSON.stringify(toManhuaViralTemplateListItem(card)), "utf8");
    expect(before).toBeGreaterThan(10_000);
    expect(after * 10).toBeLessThan(before);
  });

  it("isNativeLearned 与原判定函数逐例一致——前端不必再为一个布尔值拉整卡", () => {
    const native = heavyCard();
    expect(toManhuaViralTemplateListItem(native).isNativeLearned)
      .toBe(isNativeVideoLearnedTemplate(native));
    expect(toManhuaViralTemplateListItem(native).isNativeLearned).toBe(true);

    const legacy = heavyCard({
      beatGrid: [{ atSec: 0, conflictZh: "冲突", visualZh: "动作" }],
      audioStory: undefined,
      reusableZh: undefined,
      genPromptHintZh: undefined,
    });
    expect(toManhuaViralTemplateListItem(legacy).isNativeLearned)
      .toBe(isNativeVideoLearnedTemplate(legacy));
    expect(toManhuaViralTemplateListItem(legacy).isNativeLearned).toBe(false);
  });

  it("进度徽章要的四项原样保留，provenance 其余部分不下发", () => {
    const item = toManhuaViralTemplateListItem(heavyCard());
    expect(item.provenance?.nativeVideoDeepRead).toEqual({
      successSegments: 5,
      attemptedSegments: 6,
      assemblyComplete: false,
      completedSegmentIndexes: [0, 1, 2, 3, 4],
    });
  });

  it("没有 provenance 的旧卡不会凭空长出这个字段", () => {
    const item = toManhuaViralTemplateListItem(heavyCard({ provenance: undefined }));
    expect(item.provenance).toBeUndefined();
  });

  it("分类标签保留（列表要摊平成徽章展示），没有分类时不带该键", () => {
    const tagged = heavyCard({
      classification: {
        emotionTagsZh: ["紧张"], narrativeFeatureTagsZh: [], performanceTagsZh: [],
        audiovisualTagsZh: [], audienceExperienceTagsZh: [],
      } as ManhuaViralTemplateCard["classification"],
    });
    expect(toManhuaViralTemplateListItem(tagged).classification?.emotionTagsZh).toEqual(["紧张"]);
    expect(toManhuaViralTemplateListItem(heavyCard()).classification).toBeUndefined();
  });
});
