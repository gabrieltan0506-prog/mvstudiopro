import { describe, expect, it } from "vitest";
import { applyShotDescriptionsFromText, parseShotDescriptionTable, patchShotDescriptionSection } from "./manhuaShotDescriptionPersist";

describe("分镜画面描述覆盖表", () => {
  it("只改当前镜，保留其他镜和台词段；旧稿无覆盖时惰性", () => {
    const original = "原稿\n\n## 分镜台词\n\n| 镜号 | 台词 |\n| --- | --- |\n| 1 | 娘：阿菁 |\n";
    const once = patchShotDescriptionSection(original, { 1: "阿菁背娘前行｜墨屠贴身跟" });
    const twice = patchShotDescriptionSection(once, { 2: "曹三挡住去路" });
    expect(twice).toContain("| 1 | 娘：阿菁 |");
    expect(parseShotDescriptionTable(twice)).toEqual({ 1: "阿菁背娘前行｜墨屠贴身跟", 2: "曹三挡住去路" });
    expect(applyShotDescriptionsFromText([{ index: 1, actionZh: "旧动作" }, { index: 3, actionZh: "不变" }], twice))
      .toEqual([{ index: 1, actionZh: "阿菁背娘前行｜墨屠贴身跟" }, { index: 3, actionZh: "不变" }]);
    expect(applyShotDescriptionsFromText([{ index: 1, actionZh: "旧动作" }], original)[0]?.actionZh).toBe("旧动作");
    expect(parseShotDescriptionTable(patchShotDescriptionSection(original, { 1: "阿菁背娘前行\n墨屠在侧|跟随" }))[1])
      .toBe("阿菁背娘前行 墨屠在侧｜跟随");
    const longDraft = "旧稿".repeat(110);
    const many = patchShotDescriptionSection(original, { 101: longDraft });
    expect(parseShotDescriptionTable(many)[101]).toBe(longDraft);
    expect(patchShotDescriptionSection(many, { 1: "新镜动作" })).toContain(`| 101 | ${longDraft} |`);
  });
});
