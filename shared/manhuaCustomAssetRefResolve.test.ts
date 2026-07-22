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
