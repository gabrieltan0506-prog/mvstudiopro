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

  it("ancient without sheet files still fuses ready scene+prop + hard lock", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword", "demo_prop_ancient_jade"],
    });
    expect(plan.missingLabelsZh.some((x) => /古风/.test(x))).toBe(true);
    expect(plan.editPromptAddonZh).toContain("【古装时代硬锁·必守】");
    expect(plan.editPromptAddonZh).toContain("雨夜江湖刀客");
    expect(plan.editPromptAddonZh).toMatch(/禁止：西装|禁止西装/);
    // 场景/道具已落盘时应能 edit；底图为环境时不得画现代人
    if (plan.canEdit) {
      expect(plan.refImageUrl).toMatch(/\/manhua-(scenes|props)\//);
      expect(plan.editFusionUrls.length + 1).toBeGreaterThanOrEqual(1);
      expect(plan.editPromptAddonZh).toContain("禁止在宫景里画现代人");
    }
  });

  it("ancient path does not attach urban character sheets", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_phoenix_empress"],
      characterIds: ["char_f_01"],
      sceneId: "scene_12",
      propIds: ["demo_prop_ancient_jade"],
    });
    expect(plan.refs.every((r) => r.role !== "character")).toBe(true);
    expect(plan.editPromptAddonZh).toContain("古装时代硬锁");
  });

  it("absolutizes site-relative asset paths for OpenAI edits download", () => {
    expect(absolutizeManhuaAssetUrl("/manhua-props/x.jpg", "https://www.mvstudiopro.com")).toBe(
      "https://www.mvstudiopro.com/manhua-props/x.jpg",
    );
    expect(absolutizeManhuaAssetUrl("https://cdn.example/a.png")).toBe("https://cdn.example/a.png");
    expect(absolutizeManhuaAssetUrl("/manhua-props/x.jpg", "")).toBe("");
  });
});
