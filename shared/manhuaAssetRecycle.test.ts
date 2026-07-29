import { describe, expect, it } from "vitest";
import {
  anonymizeManhuaLibraryLabelZh,
  decideManhuaAssetRecycle,
} from "./manhuaAssetRecycle";

describe("decideManhuaAssetRecycle 自动回收准入", () => {
  it("完整成品 → 去名回收进公有库", () => {
    const d = decideManhuaAssetRecycle({ hasImage: true });
    expect(d.recycle).toBe(true);
    expect(d.purge).toBe(false);
  });

  it("半成品(无成品图) → 踢除、不入库", () => {
    const d = decideManhuaAssetRecycle({ hasImage: false });
    expect(d.recycle).toBe(false);
    expect(d.purge).toBe(true);
    expect(d.reasonZh).toMatch(/半成品|踢除/);
  });

  it("手动上传参考 → 保留但不自动入库(版权)", () => {
    const d = decideManhuaAssetRecycle({ hasImage: true, isUpload: true });
    expect(d.recycle).toBe(false);
    expect(d.purge).toBe(false);
    expect(d.reasonZh).toMatch(/上传|不自动入库/);
  });
});

describe("anonymizeManhuaLibraryLabelZh 去名匿名", () => {
  it("抹掉剧本专名保留通用描述", () => {
    const out = anonymizeManhuaLibraryLabelZh(
      "沈沧澜·冷峻青年剑客",
      ["沈沧澜", "陆清和"],
      "character",
    );
    expect(out).not.toContain("沈沧澜");
    expect(out).toContain("冷峻青年剑客");
  });

  it("整标签就是专名 → 回退通用兜底，不泄漏", () => {
    const out = anonymizeManhuaLibraryLabelZh("陆清和", ["陆清和"], "character");
    expect(out).not.toContain("陆清和");
    expect(out).toBe("角色参考");
  });

  it("长名先抹，避免短名残片", () => {
    const out = anonymizeManhuaLibraryLabelZh(
      "沈沧澜将军·玄甲",
      ["沈", "沈沧澜"],
      "character",
    );
    expect(out).not.toContain("沈沧澜");
    expect(out).toContain("玄甲");
  });

  it("场景/道具按角色回退兜底", () => {
    expect(anonymizeManhuaLibraryLabelZh("黑松祠", ["黑松祠"], "scene")).toBe(
      "场景参考",
    );
    expect(anonymizeManhuaLibraryLabelZh("漕银账册", ["漕银账册"], "prop")).toBe(
      "道具参考",
    );
  });

  it("空标签 → 通用兜底", () => {
    expect(anonymizeManhuaLibraryLabelZh("", [], "scene")).toBe("场景参考");
    expect(anonymizeManhuaLibraryLabelZh(null, [], "prop")).toBe("道具参考");
  });
});
