import { describe, expect, it } from "vitest";
import {
  extractManhuaDramaTagLabelsZh,
  inferManhuaDramaKind,
  isManhuaDramaMixCandidate,
  manhuaDramaCategoryLabelZh,
  normalizeManhuaMixNameKey,
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
  });
});
