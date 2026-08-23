import { describe, expect, it } from "vitest";
import { resolveManhuaCustomAssetReference } from "./manhuaCustomAssetRefResolve";
import { resolveManhuaCustomAssetSeed } from "./manhuaCustomAssetSeed";

describe("resolveManhuaCustomAssetReference", () => {
  it("古风板未上架 sheet：不拿 404 路径作 exact，有近似示范则 similar", () => {
    const hit = resolveManhuaCustomAssetReference({
      role: "character",
      seedLibraryId: "arch_rain_jianghu_dao",
      topic: "雪关开荒",
    });
    expect(hit).toBeTruthy();
    expect(hit!.strategy).toBe("similar");
    expect(hit!.previewPath).toMatch(/^\/manhua-/);
    expect(hit!.previewPath).not.toMatch(/arch_rain_jianghu_dao_sheet/);
  });

  it("seed 封装：text 策略时 previewPath 为空（纯文案出图）", () => {
    const seed = resolveManhuaCustomAssetSeed({
      role: "character",
      seedLibraryId: "arch_rain_jianghu_dao",
    });
    expect(seed).toBeTruthy();
    if (seed!.strategy === "text") {
      expect(seed!.previewPath).toBe("");
    } else {
      expect(seed!.previewPath.length).toBeGreaterThan(0);
    }
  });

  it("场景有精确示范时 strategy=exact", () => {
    const hit = resolveManhuaCustomAssetReference({
      role: "scene",
      seedLibraryId: "scene_06",
    });
    expect(hit?.strategy).toBe("exact");
    expect(hit?.previewPath).toBeTruthy();
  });
});

describe("3D 档库种子只送外形（0824 审阅第二轮）", () => {
  it("付费资产生成入口不把旧二维画风带进去", () => {
    const hit = resolveManhuaCustomAssetReference({
      role: "character",
      seedLibraryId: "char_m_14",
      artStyleId: "cg_3d",
    });
    expect(hit?.strategy).toBe("exact");
    expect(hit?.promptZh).toContain("椭圆脸");
    expect(hit?.promptZh).not.toMatch(
      /半写实(?:二次元|动漫)|(?:国乙(?:游戏)?|乙女游戏)立绘|(?:韩系|韩国)(?:精致)?厚涂/,
    );
  });
});
