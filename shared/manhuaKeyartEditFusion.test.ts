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
      artStyleId: "photoreal",
    });
    // 都市：角色 sheet 可作底图；场景/道具若已落盘进融图
    expect(plan.canEdit).toBe(true);
    expect(plan.refImageUrl).toMatch(/\/manhua-characters\//);
    expect(plan.editPromptAddonZh).toContain("【静帧·示范图融图】");
  });

  it("ancient without sheet files still fuses ready scene+prop + hard lock (仿真人可 edit)", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword", "demo_prop_ancient_jade"],
      artStyleId: "photoreal",
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

  it("CG drama refuses photoreal demo edit base", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      sceneId: "scene_07",
      propIds: ["demo_prop_xianxia_sword"],
      artStyleId: "cg_drama",
    });
    expect(plan.canEdit).toBe(false);
    expect(plan.refImageUrl).toBeUndefined();
    expect(plan.editFusionUrls).toEqual([]);
    expect(plan.editPromptAddonZh).toContain("【画风执行·CG 漫剧】");
    expect(plan.editPromptAddonZh).toContain("CG 漫剧文生路径");
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

  it("prefers custom https refs and suppresses library cast/scene/prop", () => {
    const plan = planManhuaKeyartEditFusion({
      characterIds: ["char_f_01", "char_m_01"],
      sceneId: "scene_12",
      propIds: ["demo_prop_romance_ring_box"],
      artStyleId: "photoreal",
      customRefs: [
        {
          id: "cust_c",
          url: "https://cdn.example/char.jpg",
          role: "character",
          labelZh: "自传人物",
        },
        {
          id: "cust_s",
          url: "https://cdn.example/scene.jpg",
          role: "scene",
          labelZh: "自传场景",
        },
        {
          id: "cust_p",
          url: "https://cdn.example/prop.jpg",
          role: "prop",
          labelZh: "自传道具",
        },
        {
          id: "cust_unset",
          url: "https://cdn.example/ignore.jpg",
          role: "unset",
        },
      ],
    });
    expect(plan.canEdit).toBe(true);
    expect(plan.editPromptAddonZh).toContain("【静帧·用户参考融图】");
    expect(plan.refs.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        "https://cdn.example/char.jpg",
        "https://cdn.example/scene.jpg",
        "https://cdn.example/prop.jpg",
      ]),
    );
    expect(plan.refs.some((r) => r.path.includes("/manhua-characters/"))).toBe(false);
    expect(plan.refs.some((r) => r.path.includes("/manhua-scenes/") || r.path.includes("/manhua-props/"))).toBe(
      false,
    );
    expect(plan.refs.some((r) => r.path.includes("ignore.jpg"))).toBe(false);
  });

  it("ancient lane keeps hard lock with custom cast and never uses modern character as edit base", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_phoenix_empress"],
      sceneId: "scene_07",
      propIds: ["demo_prop_ancient_jade"],
      artStyleId: "photoreal",
      customRefs: [
        {
          id: "cust_tennis",
          url: "https://cdn.example/modern-tennis.jpg",
          role: "character",
          labelZh: "自传人物·网球",
        },
      ],
    });
    expect(plan.editPromptAddonZh).toContain("【古装时代硬锁·必守】");
    expect(plan.editPromptAddonZh).toContain("凤曌女帝");
    expect(plan.editPromptAddonZh).toMatch(/运动背心|网球拍|球拍/);
    expect(plan.editPromptAddonZh).toContain("整身改绘");
    // 底图必须是场景/道具，不能是现代人物照
    expect(plan.refImageUrl).not.toBe("https://cdn.example/modern-tennis.jpg");
    if (plan.canEdit) {
      expect(plan.refImageUrl).toMatch(/\/manhua-(scenes|props)\//);
      expect(plan.editFusionUrls).toContain("https://cdn.example/modern-tennis.jpg");
      expect(plan.editPromptAddonZh).toContain("禁止在宫景里画现代人");
    }
  });

  it("ancient lane without scene base falls back to generate instead of editing modern cast photo", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      artStyleId: "photoreal",
      customRefs: [
        {
          id: "cust_tennis",
          url: "https://cdn.example/modern-tennis.jpg",
          role: "character",
          labelZh: "自传人物·网球",
        },
      ],
    });
    expect(plan.canEdit).toBe(false);
    expect(plan.refImageUrl).toBeUndefined();
    expect(plan.editPromptAddonZh).toContain("【古装时代硬锁·必守】");
    expect(plan.editPromptAddonZh).toContain("禁止以现代人物参考图为底做改图");
  });
});
