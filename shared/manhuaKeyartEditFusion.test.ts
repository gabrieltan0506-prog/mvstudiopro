import { describe, expect, it } from "vitest";
import {
  absolutizeManhuaAssetUrl,
  planManhuaKeyartEditFusion,
} from "./manhuaKeyartEditFusion";

describe("manhuaKeyartEditFusion", () => {
  it("plans library-pad edit from character library (not text-gen)", () => {
    const plan = planManhuaKeyartEditFusion({
      characterIds: ["char_f_01", "char_m_01"],
      sceneId: "scene_12",
      propIds: ["demo_prop_romance_ring_box"],
      artStyleId: "photoreal",
    });
    expect(plan.canEdit).toBe(true);
    expect(plan.requireLibraryEdit).toBe(true);
    expect(plan.refImageUrl).toMatch(/\/manhua-characters\//);
    expect(plan.editPromptAddonZh).toContain("人物库垫图");
    expect(plan.editPromptAddonZh).toContain("Image-2 Edit");
    expect(plan.editPromptAddonZh).not.toContain("文生路径");
  });

  it("ancient without sheet files still fuses ready scene+prop + hard lock", () => {
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
    if (plan.canEdit) {
      expect(plan.refImageUrl).toMatch(/\/manhua-(scenes|props)\//);
      expect(plan.editFusionUrls.length + 1).toBeGreaterThanOrEqual(1);
      expect(plan.editPromptAddonZh).toContain("禁止在宫景里画现代人");
    }
  });

  it("CG drama still library-pad edits (no generated identity sheets)", () => {
    const plan = planManhuaKeyartEditFusion({
      characterIds: ["char_f_01"],
      sceneId: "scene_12",
      artStyleId: "cg_drama",
      identityImageUrls: ["https://cdn.example/charsheet-a.png"],
    });
    expect(plan.canEdit).toBe(true);
    expect(plan.refImageUrl).toMatch(/\/manhua-characters\//);
    expect(plan.refImageUrl).not.toBe("https://cdn.example/charsheet-a.png");
    expect(plan.editPromptAddonZh).toContain("【画风执行·CG 漫剧】");
    expect(plan.editPromptAddonZh).toContain("人物库垫图");
    expect(plan.editPromptAddonZh).not.toContain("设定卡身份锁");
    expect(plan.editPromptAddonZh).not.toContain("CG 漫剧文生路径");
  });

  it("ignores generated custom character refs for cast pad", () => {
    const plan = planManhuaKeyartEditFusion({
      characterIds: ["char_f_01"],
      sceneId: "scene_12",
      artStyleId: "photoreal",
      customRefs: [
        {
          id: "cust_gen",
          url: "https://cdn.example/generated-char.jpg",
          role: "character",
          labelZh: "生成定妆",
          source: "generated",
          seedLibraryId: "char_f_01",
        },
      ],
    });
    expect(plan.canEdit).toBe(true);
    expect(plan.refs.some((r) => r.path.includes("generated-char.jpg"))).toBe(false);
    expect(plan.refImageUrl).toMatch(/\/manhua-characters\//);
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

  it("keeps library cast pad even when upload refs exist", () => {
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
          source: "upload",
        },
        {
          id: "cust_s",
          url: "https://cdn.example/scene.jpg",
          role: "scene",
          labelZh: "自传场景",
          source: "upload",
        },
        {
          id: "cust_p",
          url: "https://cdn.example/prop.jpg",
          role: "prop",
          labelZh: "自传道具",
          source: "upload",
        },
        {
          id: "cust_unset",
          url: "https://cdn.example/ignore.jpg",
          role: "unset",
        },
      ],
    });
    expect(plan.canEdit).toBe(true);
    expect(plan.editPromptAddonZh).toMatch(/人物库垫图|用户垫图|用户参考/);
    expect(plan.refs.some((r) => r.path.includes("/manhua-characters/"))).toBe(true);
    expect(plan.refs.map((r) => r.path)).toEqual(
      expect.arrayContaining([
        "https://cdn.example/char.jpg",
        "https://cdn.example/scene.jpg",
        "https://cdn.example/prop.jpg",
      ]),
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
          source: "upload",
        },
      ],
    });
    expect(plan.editPromptAddonZh).toContain("【古装时代硬锁·必守】");
    expect(plan.editPromptAddonZh).toContain("凤曌女帝");
    expect(plan.editPromptAddonZh).toMatch(/运动背心|网球拍|球拍/);
    expect(plan.editPromptAddonZh).toContain("整身改绘");
    expect(plan.refImageUrl).not.toBe("https://cdn.example/modern-tennis.jpg");
    if (plan.canEdit) {
      expect(plan.refImageUrl).toMatch(/\/manhua-(scenes|props)\//);
      expect(plan.editFusionUrls).toContain("https://cdn.example/modern-tennis.jpg");
      expect(plan.editPromptAddonZh).toContain("禁止在宫景里画现代人");
    }
  });

  it("ancient lane without scene base refuses modern cast photo edit and text-gen", () => {
    const plan = planManhuaKeyartEditFusion({
      ancientArchetypeIds: ["arch_rain_jianghu_dao"],
      artStyleId: "photoreal",
      customRefs: [
        {
          id: "cust_tennis",
          url: "https://cdn.example/modern-tennis.jpg",
          role: "character",
          labelZh: "自传人物·网球",
          source: "upload",
        },
      ],
    });
    expect(plan.canEdit).toBe(false);
    expect(plan.refImageUrl).toBeUndefined();
    expect(plan.editPromptAddonZh).toContain("【古装时代硬锁·必守】");
    expect(plan.editPromptAddonZh).toMatch(/禁止.*纯文生|禁止以现代人物参考图为底/);
  });
});
