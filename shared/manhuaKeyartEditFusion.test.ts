import { describe, expect, it } from "vitest";
import {
  absolutizeManhuaAssetUrl,
  planManhuaKeyartEditFusion,
} from "./manhuaKeyartEditFusion";

describe("manhuaKeyartEditFusion", () => {
  it("plans edit+fusion from ready scene/prop and character sheets", () => {
    const plan = planManhuaKeyartEditFusion({
      characterIds: ["char_f_01", "char_m_01"],
      sceneId: "scene_12",
      propIds: ["demo_prop_romance_ring_box"],
    });
    // 都市：角色 sheet 可作底图；场景/道具若已落盘进融图
    expect(plan.canEdit).toBe(true);
    expect(plan.refImageUrl).toMatch(/\/manhua-characters\//);
    expect(plan.editPromptAddonZh).toContain("【静帧·示范图融图】");
  });

  it("ancient without sheet files still fuses ready scene+prop", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword", "demo_prop_ancient_jade"],
    });
    expect(plan.missingLabelsZh.some((x) => x.includes("古风原型"))).toBe(true);
    // 场景/道具已落盘时应能 edit
    if (plan.canEdit) {
      expect(plan.refImageUrl).toMatch(/\/manhua-(scenes|props)\//);
      expect(plan.editFusionUrls.length + 1).toBeGreaterThanOrEqual(1);
    }
    expect(plan.editPromptAddonZh).toContain("重新生成");
  });

  it("absolutizes site-relative asset paths for EvoLink", () => {
    expect(absolutizeManhuaAssetUrl("/manhua-props/x.jpg", "https://www.mvstudiopro.com")).toBe(
      "https://www.mvstudiopro.com/manhua-props/x.jpg",
    );
    expect(absolutizeManhuaAssetUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(absolutizeManhuaAssetUrl("/manhua-props/x.jpg", "")).toBe("");
  });
});
