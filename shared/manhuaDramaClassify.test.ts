import { describe, expect, it } from "vitest";
import {
  extractManhuaDramaTagLabelsZh,
  inferManhuaDramaKind,
  isManhuaDramaMixCandidate,
  looksLikeShortVideoCaption,
  manhuaDramaCategoryLabelZh,
  normalizeManhuaMixNameKey,
  shouldMarkDouyinMixAsDrama,
} from "./manhuaDramaClassify";

describe("manhuaDramaClassify", () => {
  it("infers ai_manhua vs short_drama", () => {
    expect(inferManhuaDramaKind("重生漫剧开荒")).toBe("ai_manhua");
    expect(inferManhuaDramaKind("红果竖屏短剧")).toBe("short_drama");
    expect(inferManhuaDramaKind("今日天气不错")).toBe("unknown");
  });

  it("extracts soft tags", () => {
    const tags = extractManhuaDramaTagLabelsZh("重生之我在宗门修仙还开了系统");
    expect(tags).toContain("重生");
    expect(tags).toContain("仙侠");
    expect(tags).toContain("系统");
  });

  it("normalizes mix name key", () => {
    expect(normalizeManhuaMixNameKey("《咱家剑宗团宠小师妹》")).toBe("咱家剑宗团宠小师妹");
  });

  it("category labels", () => {
    expect(manhuaDramaCategoryLabelZh("ai_manhua")).toBe("AI漫剧");
    expect(manhuaDramaCategoryLabelZh("short_drama")).toBe("短剧合集");
    expect(manhuaDramaCategoryLabelZh("unknown")).toBe("待判定");
  });

  it("rejects short-video captions posing as mix names", () => {
    expect(looksLikeShortVideoCaption("一人一句动漫")).toBe(true);
    expect(looksLikeShortVideoCaption("给他点学术滴 #music #唯美动漫插画")).toBe(true);
    expect(looksLikeShortVideoCaption("重生漫剧开局团宠")).toBe(false);
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "unknown",
        mixId: "x1",
        mixName: "一人一句动漫",
      }),
    ).toBe(false);
    expect(
      shouldMarkDouyinMixAsDrama({
        mixId: "x1",
        mixName: "一人一句动漫",
        title: "未来日记混剪",
      }).isDrama,
    ).toBe(false);
  });

  it("candidate gate", () => {
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "ai_manhua",
        mixName: "甲",
      }),
    ).toBe(true);
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "short_drama",
        mixName: "乙",
      }),
    ).toBe(true);
    expect(isManhuaDramaMixCandidate({ title: "无关口播" })).toBe(false);
    // 仅有 mix_info、无剧类词、无多集结构 → 不进榜
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "unknown",
        mixId: "m-cap",
        mixName: "看着屏幕上的主要小伙伴",
      }),
    ).toBe(false);
  });
});
