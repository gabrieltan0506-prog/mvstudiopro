import { describe, expect, it } from "vitest";
import {
  buildManhuaDramaDisplayTagsZh,
  extractManhuaDramaTagLabelsZh,
  hasDouyinAiDramaEnqueueTag,
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
    // 成片标题偶然出现「短剧」、合集名无信号 → 不标短剧
    expect(inferManhuaDramaKind("今日推荐几个短剧看看", [], "日常剪辑合集")).toBe("unknown");
    expect(inferManhuaDramaKind("第3集更新", [], "都市逆袭短剧")).toBe("short_drama");
  });

  it("extracts soft tags", () => {
    const tags = extractManhuaDramaTagLabelsZh("重生之我在宗门修仙还开了系统");
    expect(tags).toContain("重生");
    expect(tags).toContain("仙侠");
    expect(tags).toContain("系统");
  });

  it("display tags include AI+漫剧 or AI+短剧", () => {
    const manhua = buildManhuaDramaDisplayTagsZh("ai_manhua", "重生漫剧开局");
    expect(manhua.slice(0, 2)).toEqual(["AI", "漫剧"]);
    const aiShort = buildManhuaDramaDisplayTagsZh("short_drama", "AI短剧都市逆袭", [], 5);
    expect(aiShort).toContain("AI");
    expect(aiShort).toContain("短剧");
    const plainShort = buildManhuaDramaDisplayTagsZh("short_drama", "红果竖屏剧连载");
    expect(plainShort[0]).toBe("短剧");
    expect(plainShort).not.toContain("AI");
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
        tags: ["AI漫剧"],
      }),
    ).toBe(true);
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "short_drama",
        mixName: "乙短剧",
        tags: ["AI短剧"],
      }),
    ).toBe(true);
    // 无入隊标签 → 抖音不进榜（即使标了 ai_manhua）
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "ai_manhua",
        mixName: "甲",
        tags: ["AI漫剧检索"],
      }),
    ).toBe(false);
    // dramaKind 误标 short_drama 但合集名无短剧信号 → 不进榜
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "short_drama",
        mixName: "日常vlog",
        tags: ["AIGC"],
      }),
    ).toBe(false);
    expect(isManhuaDramaMixCandidate({ title: "无关口播" })).toBe(false);
    // 仅有 mix_info、无剧类词、无多集结构 → 不进榜
    expect(
      isManhuaDramaMixCandidate({
        isDrama: true,
        dramaKind: "unknown",
        mixId: "m-cap",
        mixName: "看着屏幕上的主要小伙伴",
        tags: ["AIGC"],
      }),
    ).toBe(false);
  });

  it("douyin enqueue requires AIGC / AI漫剧 / AI短剧 tag", () => {
    expect(hasDouyinAiDramaEnqueueTag(["#AIGC"])).toBe(true);
    expect(hasDouyinAiDramaEnqueueTag(["AI漫剧"])).toBe(true);
    expect(hasDouyinAiDramaEnqueueTag(["AI短剧"])).toBe(true);
    expect(hasDouyinAiDramaEnqueueTag(["AI漫剧检索"])).toBe(false);
    expect(hasDouyinAiDramaEnqueueTag(["重生", "仙侠"])).toBe(false);
    expect(
      shouldMarkDouyinMixAsDrama({
        mixId: "m1",
        mixName: "重生漫剧开局团宠",
        title: "第1集",
        tags: ["重生漫剧"],
      }).isDrama,
    ).toBe(false);
    expect(
      shouldMarkDouyinMixAsDrama({
        mixId: "m1",
        mixName: "重生漫剧开局团宠",
        title: "第1集",
        tags: ["AI漫剧"],
      }).isDrama,
    ).toBe(true);
  });
});
